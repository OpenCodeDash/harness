import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import type { CriterionSpec, DomainPack } from "../domain/types.ts";
import { criterionFactKey } from "../domain/types.ts";
import {
  CriterionSchema,
  criterionFromImageFeature,
  fallbackCriteria,
  legacyCriteria,
  normaliseCriteria,
} from "./criteria.ts";
import {
  DEFAULT_BUDGETS,
  DEFAULT_SOURCE_SCOPE,
  type Brief,
  type BriefDelta,
  type Commute,
  type HardConstraints,
  type SourceScope,
  type WebScope,
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

const SourcesYaml = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  prefer: z.array(z.string()).optional(),
  web: z.enum(["open", "structured-only", "off"]).optional(),
});

function cleanSourceList(values?: string[]): string[] | undefined {
  const cleaned = [
    ...new Set(
      (values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean),
    ),
  ];
  return cleaned.length ? cleaned : undefined;
}

export function normaliseSourceScope(raw?: {
  allow?: string[];
  deny?: string[];
  prefer?: string[];
  web?: WebScope;
}): SourceScope {
  const allow = cleanSourceList(raw?.allow);
  const deny = cleanSourceList(raw?.deny);
  const prefer = cleanSourceList(raw?.prefer);
  return {
    ...(allow ? { allow } : {}),
    ...(deny ? { deny } : {}),
    ...(prefer ? { prefer } : {}),
    web: raw?.web ?? DEFAULT_SOURCE_SCOPE.web,
  };
}

export const BriefYamlSchema = z.object({
  version: z.number().int().positive().optional(),
  domain: z.string().optional(),
  prompt: z.string().optional(),
  anchors: z
    .object({ work: AnchorYaml.optional(), commute: CommuteYaml.optional() })
    .optional(),
  hard: HardYaml.optional(),
  criteria: z.array(CriterionSchema).optional(),
  soft: z
    .array(z.object({ key: z.string().min(1), weight: z.number().min(0).max(1) }))
    .optional(),
  unknown_policy: z.enum(["flag", "penalize", "investigate"]).optional(),
  sources: SourcesYaml.optional(),
  budgets: BudgetsYaml.optional(),
  assumptions: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
});

export type BriefYaml = z.infer<typeof BriefYamlSchema>;

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

export function fromYaml(raw: BriefYaml, pack?: DomainPack): Brief {
  const warnings = [...(raw.warnings ?? [])];
  const commute = raw.anchors?.commute;

  let criteria: CriterionSpec[];
  if (raw.criteria?.length) {
    criteria = normaliseCriteria(raw.criteria, pack, warnings);
  } else if (raw.soft?.length) {
    if (!pack) {
      throw new Error("legacy brief with `soft` requires a domain pack");
    }
    criteria = normaliseCriteria(
      legacyCriteria(pack, raw.soft, warnings),
      pack,
      warnings,
    );
  } else if (pack) {
    criteria = fallbackCriteria(pack);
  } else {
    criteria = [];
  }

  const budgets = raw.budgets ?? {};
  return {
    version: raw.version ?? 1,
    domain: raw.domain ?? pack?.id ?? "generic",
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
    criteria,
    unknownPolicy: raw.unknown_policy ?? "flag",
    sources: normaliseSourceScope(raw.sources),
    budgets: {
      maxListings: budgets.max_listings ?? DEFAULT_BUDGETS.maxListings,
      maxUsd: budgets.max_usd ?? DEFAULT_BUDGETS.maxUsd,
      maxMinutes: budgets.max_minutes ?? DEFAULT_BUDGETS.maxMinutes,
      visionMax: budgets.vision_max ?? DEFAULT_BUDGETS.visionMax,
    },
    assumptions: raw.assumptions ?? [],
    warnings,
  };
}

function criterionToYaml(criterion: CriterionSpec): Record<string, unknown> {
  return compact({
    key: criterion.key,
    label: criterion.label,
    weight: criterion.weight,
    kind: criterion.kind,
    normalizer: compact({ ...criterion.normalizer }),
    source: compact({ ...criterion.source }),
    origin: criterion.origin,
    hard: criterion.hard ? compact({ ...criterion.hard }) : undefined,
    unknown: criterion.unknown,
    rationale: criterion.rationale,
  });
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
    criteria: brief.criteria.map(criterionToYaml) as BriefYaml["criteria"],
    unknown_policy: brief.unknownPolicy,
    sources:
      brief.sources.web === "open" &&
      !brief.sources.allow?.length &&
      !brief.sources.deny?.length &&
      !brief.sources.prefer?.length
        ? undefined
        : compact({
            allow: brief.sources.allow,
            deny: brief.sources.deny,
            prefer: brief.sources.prefer,
            web: brief.sources.web === "open" ? undefined : brief.sources.web,
          }),
    budgets: {
      max_listings: brief.budgets.maxListings,
      max_usd: brief.budgets.maxUsd,
      max_minutes: brief.budgets.maxMinutes,
      vision_max: brief.budgets.visionMax,
    },
    assumptions: brief.assumptions,
    warnings: brief.warnings,
  }) as BriefYaml;
}

export function parseBrief(text: string, pack?: DomainPack): Brief {
  return fromYaml(BriefYamlSchema.parse(parseYaml(text)), pack);
}

export function parseBriefData(data: unknown, pack?: DomainPack): Brief {
  if (typeof data === "string") return parseBrief(data, pack);
  return fromYaml(BriefYamlSchema.parse(data), pack);
}

export function serializeBrief(brief: Brief): string {
  return stringifyYaml(toYaml(brief), { lineWidth: 100 });
}

export interface BriefExtractor {
  extract(input: { prompt: string; pack: DomainPack }): Promise<unknown>;
}

export function resolveKey(pack: DomainPack, key: string): string | null {
  const items = [...pack.fields, ...pack.imageFeatures];
  const normalise = (value: string) => value.trim().toLowerCase();
  const matches = (candidate: string, item: (typeof items)[number]) => {
    const value = normalise(candidate);
    return (
      item.key.toLowerCase() === value ||
      item.key.toLowerCase() === value.replace(/\s+/g, "_") ||
      item.label.toLowerCase() === value ||
      (item.aliases ?? []).some((alias) => alias.toLowerCase() === value)
    );
  };

  const direct = items.find((item) => matches(key, item));
  if (direct) return direct.key;

  for (const part of key.split(/\s+and\s+|,/)) {
    const found = items.find((item) => matches(part, item));
    if (found) return found.key;
  }
  return null;
}

export function briefFromExtraction(
  prompt: string,
  pack: DomainPack,
  raw: unknown,
): Brief {
  const parsed = BriefYamlSchema.parse(raw ?? {});
  const warnings = [...(parsed.warnings ?? [])];
  let criteria = parsed.criteria?.length
    ? normaliseCriteria(parsed.criteria, pack, warnings)
    : parsed.soft?.length
      ? normaliseCriteria(
          legacyCriteria(pack, parsed.soft, warnings),
          pack,
          warnings,
        )
      : [];

  if (criteria.length === 0) {
    criteria = fallbackCriteria(pack);
    warnings.push(
      `no criteria were extracted; using ${pack.id} suggestions as a fallback`,
    );
  }

  const hard: HardConstraints = {
    rentMax: parsed.hard?.rent_max,
    bedrooms: parsed.hard?.bedrooms,
    areas: parsed.hard?.areas,
    required: parsed.hard?.required,
  };
  if (hard.required) {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(hard.required)) {
      resolved[resolveKey(pack, key) ?? key] = value;
    }
    hard.required = resolved;
  }

  const brief: Brief = {
    version: 1,
    domain: pack.id,
    prompt,
    anchors: {
      work: parsed.anchors?.work,
      commute: parsed.anchors?.commute
        ? {
            mode: parsed.anchors.commute.mode ?? "drive",
            maxMinutes: parsed.anchors.commute.max_minutes,
            hard: parsed.anchors.commute.hard ?? false,
          }
        : undefined,
    },
    hard,
    criteria,
    unknownPolicy: parsed.unknown_policy ?? "flag",
    sources: normaliseSourceScope(parsed.sources),
    budgets: {
      maxListings:
        parsed.budgets?.max_listings ?? DEFAULT_BUDGETS.maxListings,
      maxUsd: parsed.budgets?.max_usd ?? DEFAULT_BUDGETS.maxUsd,
      maxMinutes:
        parsed.budgets?.max_minutes ?? DEFAULT_BUDGETS.maxMinutes,
      visionMax: parsed.budgets?.vision_max ?? DEFAULT_BUDGETS.visionMax,
    },
    assumptions: parsed.assumptions ?? [],
    warnings,
  };

  brief.criteria = brief.criteria.filter((criterion) => {
    if (
      criterion.source.type === "derived" &&
      criterion.source.evaluator === "commute" &&
      !brief.anchors.commute &&
      !brief.anchors.work
    ) {
      return false;
    }
    if (
      criterion.source.type === "field" &&
      criterion.source.field === "bedrooms" &&
      brief.hard.bedrooms
    ) {
      return false;
    }
    if (
      criterion.source.type === "field" &&
      criterion.source.field === "rent" &&
      brief.hard.rentMax !== undefined
    ) {
      return false;
    }
    return true;
  });

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

function sourceScopeAssumptions(sources: SourceScope): string[] {
  const assumptions: string[] = [];
  if (sources.allow?.length) {
    assumptions.push(`searching only: ${sources.allow.join(", ")}`);
  }
  if (sources.deny?.length) {
    assumptions.push(`excluding sources: ${sources.deny.join(", ")}`);
  }
  if (sources.prefer?.length) {
    assumptions.push(`preferring sources: ${sources.prefer.join(", ")}`);
  }
  if (sources.web === "structured-only") {
    assumptions.push("searching structured sources only");
  } else if (sources.web === "off") {
    assumptions.push(
      sources.allow?.length
        ? "open-web discovery off; allowed sources only"
        : "open-web discovery disabled",
    );
  } else if (!sources.allow?.length && !sources.deny?.length) {
    assumptions.push("searching the open web; no source restrictions");
  }
  return assumptions;
}

function deriveAssumptions(brief: Brief): string[] {
  const assumptions: string[] = [];
  assumptions.push(...sourceScopeAssumptions(brief.sources));
  const commute = brief.anchors.commute;
  if (commute) {
    assumptions.push(
      `"near work" means <=${commute.maxMinutes} min ${commute.mode}${
        commute.hard ? " (hard limit)" : ""
      }`,
    );
  }
  if (brief.criteria.some((criterion) => criterion.source.type === "image")) {
    assumptions.push("image criteria are inferred from photos, not guaranteed");
  }
  if (brief.criteria.some((criterion) => criterion.source.type === "text")) {
    assumptions.push("text criteria depend on what the listing description says");
  }
  const suggested = brief.criteria.filter(
    (criterion) => criterion.origin === "suggested",
  ).length;
  if (suggested > 0) {
    assumptions.push(
      `${suggested} suggested criteria included; remove any you do not want before starting`,
    );
  }
  if (
    !brief.hard.bedrooms &&
    brief.criteria.some(
      (criterion) =>
        criterion.source.type === "field" &&
        criterion.source.field === "bedrooms",
    )
  ) {
    assumptions.push("bedroom count is treated as a soft preference");
  }
  if (brief.unknownPolicy === "flag") {
    assumptions.push("missing facts are flagged, not penalised");
  }
  return assumptions;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function applyBriefDelta(
  brief: Brief,
  delta: BriefDelta,
  pack?: DomainPack,
): Brief {
  const next = structuredClone(brief);
  next.version = brief.version + 1;

  if (delta.setWeights) {
    for (const criterion of next.criteria) {
      const weight = delta.setWeights[criterion.key];
      if (weight !== undefined) criterion.weight = clamp01(weight);
    }
  }

  if (delta.addCriteria?.length) {
    const added = normaliseCriteria(delta.addCriteria, pack, next.warnings);
    const byKey = new Map(next.criteria.map((criterion) => [criterion.key, criterion]));
    for (const criterion of added) byKey.set(criterion.key, criterion);
    next.criteria = [...byKey.values()];
  }

  if (delta.features?.length && pack) {
    const byKey = new Map(next.criteria.map((criterion) => [criterion.key, criterion]));
    for (const featureKey of delta.features) {
      const feature = pack.imageFeatures.find(
        (candidate) =>
          candidate.key === featureKey ||
          (candidate.aliases ?? []).includes(featureKey) ||
          candidate.label.toLowerCase() === featureKey.toLowerCase(),
      );
      if (!feature) continue;
      const criterion = criterionFromImageFeature(feature);
      byKey.set(criterion.key, criterion);
    }
    next.criteria = [...byKey.values()];
  }

  if (delta.removeCriteria?.length) {
    const remove = new Set(delta.removeCriteria);
    next.criteria = next.criteria.filter(
      (criterion) => !remove.has(criterion.key),
    );
  }

  if (delta.hard) {
    next.hard = mergeHard(next.hard, delta.hard);
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

function sourceLabel(criterion: CriterionSpec): string {
  switch (criterion.source.type) {
    case "field":
      return `field:${criterion.source.field}`;
    case "derived":
      return `derived:${criterion.source.evaluator}`;
    case "text":
      return "text";
    case "image":
      return "image";
  }
}

function hardLabel(criterion: CriterionSpec): string {
  const hard = criterion.hard;
  if (!hard) return "";
  switch (hard.op) {
    case "eq":
      return ` · hard ${JSON.stringify(hard.value)}`;
    case "in":
      return ` · hard in ${JSON.stringify(hard.values)}`;
    case "lte":
      return ` · hard <= ${hard.value}`;
    case "gte":
      return ` · hard >= ${hard.value}`;
    case "range": {
      const min = hard.min ?? "-∞";
      const max = hard.max ?? "∞";
      return ` · hard ${min}..${max}`;
    }
  }
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
  if (brief.hard.required && Object.keys(brief.hard.required).length) {
    hard.push(
      `required: ${Object.entries(brief.hard.required)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(", ")}`,
    );
  }
  lines.push(`Hard: ${hard.length ? hard.join(" · ") : "none"}`);

  const scope = [`web ${brief.sources.web}`];
  if (brief.sources.allow?.length) {
    scope.push(`allow: ${brief.sources.allow.join(", ")}`);
  }
  if (brief.sources.deny?.length) {
    scope.push(`deny: ${brief.sources.deny.join(", ")}`);
  }
  if (brief.sources.prefer?.length) {
    scope.push(`prefer: ${brief.sources.prefer.join(", ")}`);
  }
  lines.push(`Sources: ${scope.join(" · ")}`);

  const explicit = brief.criteria.filter(
    (criterion) => criterion.origin === "explicit",
  );
  const suggested = brief.criteria.filter(
    (criterion) => criterion.origin === "suggested",
  );

  if (explicit.length) {
    lines.push("Criteria:");
    for (const criterion of explicit) {
      lines.push(
        `  - ${criterion.label} ${criterion.weight.toFixed(2)} [${sourceLabel(criterion)}]${hardLabel(criterion)}`,
      );
    }
  } else {
    lines.push("Criteria: none");
  }

  if (suggested.length) {
    lines.push("Suggested:");
    for (const criterion of suggested) {
      lines.push(
        `  - ${criterion.label} ${criterion.weight.toFixed(2)} [${sourceLabel(criterion)}]${
          criterion.rationale ? ` — ${criterion.rationale}` : ""
        }`,
      );
    }
  }

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
  for (const warning of brief.warnings) {
    lines.push(`Warning: ${warning}`);
  }
  return lines.join("\n");
}

export { criterionFactKey };
