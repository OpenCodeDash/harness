import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import type { DomainPack } from "../domain/types.ts";
import { findField, findImageFeature } from "../domain/types.ts";
import {
  DEFAULT_BUDGETS,
  type Brief,
  type BriefDelta,
  type Commute,
  type HardConstraints,
  type SoftCriterion,
} from "./types.ts";

const AnchorYaml = z.object({
  address: z.string().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
});

const CommuteYaml = z.object({
  mode: z.enum(["drive", "walk", "cycle", "transit"]).optional(),
  max_minutes: z.number().positive(),
  hard: z.boolean().optional(),
});

const HardYaml = z.object({
  rent_max: z.number().positive().optional(),
  bedrooms: z
    .object({
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().nonnegative().optional(),
    })
    .optional(),
  areas: z.array(z.string()).optional(),
  required: z.record(z.string(), z.unknown()).optional(),
});

const BudgetsYaml = z.object({
  max_listings: z.number().int().positive().optional(),
  max_usd: z.number().nonnegative().optional(),
  max_minutes: z.number().positive().optional(),
  vision_max: z.number().int().nonnegative().optional(),
});

export const BriefYamlSchema = z.object({
  version: z.number().int().positive().optional(),
  domain: z.string().optional(),
  prompt: z.string().optional(),
  anchors: z
    .object({ work: AnchorYaml.optional(), commute: CommuteYaml.optional() })
    .optional(),
  hard: HardYaml.optional(),
  soft: z
    .array(z.object({ key: z.string().min(1), weight: z.number().min(0).max(1) }))
    .optional(),
  unknown_policy: z.enum(["flag", "penalize", "investigate"]).optional(),
  budgets: BudgetsYaml.optional(),
  assumptions: z.array(z.string()).optional(),
});

export type BriefYaml = z.infer<typeof BriefYamlSchema>;

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

export function fromYaml(raw: BriefYaml): Brief {
  const budgets = raw.budgets ?? {};
  const commute = raw.anchors?.commute;
  return {
    version: raw.version ?? 1,
    domain: raw.domain ?? "property",
    prompt: raw.prompt ?? "",
    anchors: {
      work: raw.anchors?.work,
      commute: commute
        ? {
            mode: commute.mode ?? "drive",
            maxMinutes: commute.max_minutes,
            hard: commute.hard ?? false,
          }
        : undefined,
    },
    hard: {
      rentMax: raw.hard?.rent_max,
      bedrooms: raw.hard?.bedrooms,
      areas: raw.hard?.areas,
      required: raw.hard?.required,
    },
    soft: raw.soft ?? [],
    unknownPolicy: raw.unknown_policy ?? "flag",
    budgets: {
      maxListings: budgets.max_listings ?? DEFAULT_BUDGETS.maxListings,
      maxUsd: budgets.max_usd ?? DEFAULT_BUDGETS.maxUsd,
      maxMinutes: budgets.max_minutes ?? DEFAULT_BUDGETS.maxMinutes,
      visionMax: budgets.vision_max ?? DEFAULT_BUDGETS.visionMax,
    },
    assumptions: raw.assumptions ?? [],
  };
}

export function toYaml(brief: Brief): BriefYaml {
  return compact({
    version: brief.version,
    domain: brief.domain,
    prompt: brief.prompt,
    anchors: compact({
      work: brief.anchors.work ? compact({ ...brief.anchors.work }) : undefined,
      commute: brief.anchors.commute
        ? compact({
            mode: brief.anchors.commute.mode,
            max_minutes: brief.anchors.commute.maxMinutes,
            hard: brief.anchors.commute.hard,
          })
        : undefined,
    }),
    hard: compact({
      rent_max: brief.hard.rentMax,
      bedrooms: brief.hard.bedrooms,
      areas: brief.hard.areas,
      required: brief.hard.required,
    }),
    soft: brief.soft.map((criterion) => ({
      key: criterion.key,
      weight: criterion.weight,
    })),
    unknown_policy: brief.unknownPolicy,
    budgets: {
      max_listings: brief.budgets.maxListings,
      max_usd: brief.budgets.maxUsd,
      max_minutes: brief.budgets.maxMinutes,
      vision_max: brief.budgets.visionMax,
    },
    assumptions: brief.assumptions,
  }) as BriefYaml;
}

export function parseBrief(text: string): Brief {
  return fromYaml(BriefYamlSchema.parse(parseYaml(text)));
}

export function serializeBrief(brief: Brief): string {
  return stringifyYaml(toYaml(brief), { lineWidth: 100 });
}

export interface BriefExtractor {
  extract(input: { prompt: string; pack: DomainPack }): Promise<unknown>;
}

export function resolveKey(pack: DomainPack, key: string): string | null {
  const direct =
    findField(pack, key) ?? findImageFeature(pack, key) ??
    pack.fields.find((field) => (field.aliases ?? []).includes(key)) ??
    pack.imageFeatures.find((feature) => (feature.aliases ?? []).includes(key));
  return direct?.key ?? null;
}

export function briefFromExtraction(
  prompt: string,
  pack: DomainPack,
  raw: unknown,
): Brief {
  const parsed = BriefYamlSchema.parse(raw ?? {});
  const weights = new Map(
    pack.defaultCriteria.map((criterion) => [criterion.key, criterion.weight]),
  );
  for (const item of parsed.soft ?? []) {
    const key = resolveKey(pack, item.key);
    if (key && weights.has(key)) weights.set(key, item.weight);
  }

  if (parsed.hard?.bedrooms) weights.delete("bedrooms");
  if (!parsed.anchors?.commute && !parsed.anchors?.work) weights.delete("commute");

  const candidate: BriefYaml = {
    version: 1,
    domain: pack.id,
    prompt,
    anchors: parsed.anchors,
    hard: parsed.hard,
    soft: [...weights].map(([key, weight]) => ({ key, weight })),
    unknown_policy: parsed.unknown_policy,
    budgets: parsed.budgets,
    assumptions: parsed.assumptions,
  };

  const brief = fromYaml(BriefYamlSchema.parse(candidate));
  brief.assumptions = [
    ...new Set([...brief.assumptions, ...deriveAssumptions(brief)]),
  ];
  return brief;
}

export async function compileBrief(
  prompt: string,
  pack: DomainPack,
  extractor: BriefExtractor,
): Promise<Brief> {
  const raw = await extractor.extract({ prompt, pack });
  return briefFromExtraction(prompt, pack, raw);
}

function deriveAssumptions(brief: Brief): string[] {
  const assumptions: string[] = [];
  const commute = brief.anchors.commute;
  if (commute) {
    assumptions.push(
      `"near work" means <=${commute.maxMinutes} min ${commute.mode}${
        commute.hard ? " (hard limit)" : ""
      }`,
    );
  }
  if (brief.soft.some((criterion) => criterion.key === "sunlight")) {
    assumptions.push("sunlight is inferred from photos, not guaranteed");
  }
  if (!brief.hard.bedrooms && brief.soft.some((c) => c.key === "bedrooms")) {
    assumptions.push("bedroom count is treated as a soft preference");
  }
  if (brief.unknownPolicy === "flag") {
    assumptions.push("missing facts are flagged, not penalised");
  }
  return assumptions;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function applyBriefDelta(brief: Brief, delta: BriefDelta): Brief {
  const next = structuredClone(brief);
  next.version = brief.version + 1;

  if (delta.setWeights) {
    const weights = new Map(
      next.soft.map((criterion) => [criterion.key, criterion.weight]),
    );
    for (const [key, weight] of Object.entries(delta.setWeights)) {
      weights.set(key, clamp01(weight));
    }
    next.soft = [...weights].map(([key, weight]) => ({ key, weight }));
  }

  if (delta.hard) {
    next.hard = {
      ...mergeHard(next.hard, delta.hard),
    };
  }

  if (delta.commute) {
    const base: Commute = next.anchors.commute ?? {
      mode: "drive",
      maxMinutes: 30,
      hard: false,
    };
    next.anchors.commute = {
      mode: delta.commute.mode ?? base.mode,
      maxMinutes: delta.commute.maxMinutes ?? base.maxMinutes,
      hard: delta.commute.hard ?? base.hard,
    };
  }

  if (delta.addAreas?.length) {
    next.hard.areas = [
      ...new Set([...(next.hard.areas ?? []), ...delta.addAreas]),
    ];
  }

  if (delta.addAssumptions?.length) {
    next.assumptions = [...new Set([...next.assumptions, ...delta.addAssumptions])];
  }

  if (delta.removeAssumptions?.length) {
    const remove = new Set(delta.removeAssumptions);
    next.assumptions = next.assumptions.filter((item) => !remove.has(item));
  }

  return next;
}

function mergeHard(
  base: HardConstraints,
  patch: Partial<HardConstraints>,
): HardConstraints {
  const merged: HardConstraints = { ...base };
  if (patch.rentMax !== undefined) merged.rentMax = patch.rentMax;
  if (patch.bedrooms !== undefined) merged.bedrooms = patch.bedrooms;
  if (patch.areas !== undefined) merged.areas = patch.areas;
  if (patch.required !== undefined) {
    merged.required = { ...(base.required ?? {}), ...patch.required };
  }
  return merged;
}

export function echoBrief(brief: Brief): string {
  const lines: string[] = [];
  const hard: string[] = [];
  if (brief.hard.rentMax !== undefined) hard.push(`rent <= ${brief.hard.rentMax}`);
  const bedrooms = brief.hard.bedrooms;
  if (bedrooms) {
    const min = bedrooms.min ?? 0;
    const max = bedrooms.max;
    hard.push(max === undefined ? `beds >= ${min}` : `beds ${min}-${max}`);
  }
  if (brief.hard.areas?.length) hard.push(`areas: ${brief.hard.areas.join(", ")}`);
  lines.push(`Hard: ${hard.length ? hard.join(" · ") : "none"}`);

  const soft = brief.soft
    .map((criterion) => `${criterion.key} ${criterion.weight.toFixed(2)}`)
    .join(" · ");
  lines.push(`Soft: ${soft || "none"}`);

  if (brief.anchors.commute) {
    const commute = brief.anchors.commute;
    lines.push(
      `Commute: ${commute.mode} <= ${commute.maxMinutes} min${
        commute.hard ? " (hard)" : ""
      }`,
    );
  }

  lines.push(`Unknowns: ${brief.unknownPolicy}`);
  lines.push(
    `Budget: ${brief.budgets.maxListings} listings · $${brief.budgets.maxUsd} · ${brief.budgets.maxMinutes} min · vision ${brief.budgets.visionMax}`,
  );
  for (const assumption of brief.assumptions) {
    lines.push(`Assumed: ${assumption}`);
  }
  return lines.join("\n");
}
