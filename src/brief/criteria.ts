import { z } from "zod";
import type {
  CriterionSpec,
  DerivedEvaluator,
  DomainPack,
  HardPredicate,
  ImageFeatureDef,
  Normalizer,
} from "../domain/types.ts";
import { DERIVED_EVALUATORS } from "../domain/types.ts";

export const CriterionSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("field"), field: z.string().min(1) }),
  z.object({ type: z.literal("text"), prompt: z.string().min(1) }),
  z.object({
    type: z.literal("image"),
    prompt: z.string().min(1),
    options: z.array(z.string().min(1)).optional(),
  }),
  z.object({
    type: z.literal("derived"),
    evaluator: z.enum(["commute", "price_per_bedroom", "price_per_bathroom"]),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
]);

export const NormalizerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("boolean"), prefer: z.boolean().optional() }),
  z.object({ type: z.literal("lower-is-better"), max: z.number().positive() }),
  z.object({ type: z.literal("higher-is-better"), max: z.number().positive() }),
  z.object({
    type: z.literal("range"),
    min: z.number(),
    max: z.number(),
  }),
  z.object({
    type: z.literal("enum"),
    scores: z.record(z.string(), z.number().min(0).max(1)),
  }),
]);

export const HardPredicateSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("eq"), value: z.unknown() }),
  z.object({ op: z.literal("in"), values: z.array(z.unknown()) }),
  z.object({ op: z.literal("lte"), value: z.number() }),
  z.object({ op: z.literal("gte"), value: z.number() }),
  z.object({
    op: z.literal("range"),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
]);

export const CriterionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1).optional(),
  weight: z.number().min(0).max(1),
  kind: z.enum(["boolean", "number", "enum"]),
  normalizer: NormalizerSchema,
  source: CriterionSourceSchema,
  origin: z.enum(["explicit", "suggested"]).optional(),
  hard: HardPredicateSchema.optional(),
  unknown: z.enum(["flag", "penalize"]).optional(),
  rationale: z.string().optional(),
});

export type CriterionInput = z.infer<typeof CriterionSchema>;

export const MAX_CRITERIA = 14;
export const MAX_SUGGESTED = 8;
export const MAX_IMAGE_CRITERIA = 8;
export const MAX_TEXT_CRITERIA = 8;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function slugifyKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveField(pack: DomainPack | undefined, field: string): string | null {
  if (!pack) return field;
  const value = field.trim().toLowerCase();
  const found = pack.fields.find(
    (candidate) =>
      candidate.key.toLowerCase() === value ||
      candidate.key.toLowerCase() === value.replace(/\s+/g, "_") ||
      candidate.label.toLowerCase() === value ||
      (candidate.aliases ?? []).some((alias) => alias.toLowerCase() === value),
  );
  return found?.key ?? null;
}

function validateHard(
  hard: HardPredicate,
  kind: CriterionSpec["kind"],
): boolean {
  if (hard.op === "eq") {
    if (kind === "boolean") return typeof hard.value === "boolean";
    if (kind === "number") return typeof hard.value === "number";
    return typeof hard.value === "string";
  }
  if (hard.op === "in") {
    if (kind === "boolean") return hard.values.every((v) => typeof v === "boolean");
    if (kind === "number") return hard.values.every((v) => typeof v === "number");
    return hard.values.every((v) => typeof v === "string");
  }
  if (kind !== "number") return false;
  if (hard.op === "range") return true;
  return typeof hard.value === "number";
}

export function normaliseCriterion(
  raw: CriterionInput,
  pack: DomainPack | undefined,
  warnings: string[],
): CriterionSpec | null {
  const key = slugifyKey(raw.key);
  if (!key) {
    warnings.push(`dropped criterion with unusable key "${raw.key}"`);
    return null;
  }

  let source = raw.source as CriterionSpec["source"];
  if (source.type === "field") {
    const field = resolveField(pack, source.field);
    if (!field) {
      warnings.push(`dropped "${key}": unknown field "${source.field}"`);
      return null;
    }
    source = { type: "field", field };
  } else if (source.type === "derived") {
    if (!DERIVED_EVALUATORS.includes(source.evaluator as DerivedEvaluator)) {
      warnings.push(`dropped "${key}": unknown evaluator "${source.evaluator}"`);
      return null;
    }
  } else if (!source.prompt.trim()) {
    warnings.push(`dropped "${key}": empty extraction prompt`);
    return null;
  }

  const normalizer = raw.normalizer as Normalizer;
  const matchesKind =
    (raw.kind === "boolean" && normalizer.type === "boolean") ||
    (raw.kind === "number" &&
      ["lower-is-better", "higher-is-better", "range"].includes(normalizer.type)) ||
    (raw.kind === "enum" && normalizer.type === "enum");
  if (!matchesKind) {
    warnings.push(
      `dropped "${key}": normalizer "${normalizer.type}" does not fit kind "${raw.kind}"`,
    );
    return null;
  }

  let hard = raw.hard as HardPredicate | undefined;
  const origin = raw.origin ?? "explicit";
  if (hard) {
    if (origin === "suggested") {
      warnings.push(`dropped hard constraint on suggested criterion "${key}"`);
      hard = undefined;
    } else if (!validateHard(hard, raw.kind)) {
      warnings.push(`dropped invalid hard constraint on "${key}"`);
      hard = undefined;
    }
  }

  const unknown = origin === "suggested" ? "flag" : raw.unknown;

  return {
    key,
    label: raw.label?.trim() || key.replaceAll("_", " "),
    weight: clamp01(raw.weight),
    kind: raw.kind,
    normalizer,
    source,
    origin,
    ...(hard ? { hard } : {}),
    ...(unknown ? { unknown } : {}),
    ...(raw.rationale?.trim() ? { rationale: raw.rationale.trim() } : {}),
  };
}

export function normaliseCriteria(
  raw: CriterionInput[],
  pack: DomainPack | undefined,
  warnings: string[],
): CriterionSpec[] {
  const byKey = new Map<string, CriterionSpec>();
  const byLabel = new Map<string, string>();

  for (const input of raw) {
    const criterion = normaliseCriterion(input, pack, warnings);
    if (!criterion) continue;

    const labelKey = criterion.label.trim().toLowerCase();
    const existingKey = byLabel.get(labelKey);
    if (existingKey && existingKey !== criterion.key) {
      const existing = byKey.get(existingKey);
      if (existing?.origin === "explicit" && criterion.origin === "suggested") {
        warnings.push(`merged suggested "${criterion.key}" into "${existingKey}"`);
        continue;
      }
      if (existing?.origin === "suggested" && criterion.origin === "explicit") {
        byKey.delete(existingKey);
      } else {
        warnings.push(`dropped duplicate "${criterion.key}" (same label as "${existingKey}")`);
        continue;
      }
    }

    const current = byKey.get(criterion.key);
    if (current) {
      if (current.origin === "suggested" && criterion.origin === "explicit") {
        byKey.set(criterion.key, criterion);
        byLabel.set(labelKey, criterion.key);
      } else if (criterion.weight > current.weight) {
        byKey.set(criterion.key, criterion);
        byLabel.set(labelKey, criterion.key);
      }
      continue;
    }

    byKey.set(criterion.key, criterion);
    byLabel.set(labelKey, criterion.key);
  }

  const all = [...byKey.values()];
  const explicit = all.filter((criterion) => criterion.origin === "explicit");
  const suggested = all
    .filter((criterion) => criterion.origin === "suggested")
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_SUGGESTED);

  const kept: CriterionSpec[] = [];
  let images = 0;
  let texts = 0;
  for (const criterion of [...explicit, ...suggested]) {
    if (kept.length >= MAX_CRITERIA) {
      warnings.push(`dropped "${criterion.key}": criteria cap reached`);
      continue;
    }
    if (criterion.source.type === "image") {
      if (images >= MAX_IMAGE_CRITERIA) {
        warnings.push(`dropped image criterion "${criterion.key}": image cap reached`);
        continue;
      }
      images += 1;
    }
    if (criterion.source.type === "text") {
      if (texts >= MAX_TEXT_CRITERIA) {
        warnings.push(`dropped text criterion "${criterion.key}": text cap reached`);
        continue;
      }
      texts += 1;
    }
    kept.push(criterion);
  }
  return kept;
}

export function fallbackCriteria(pack: DomainPack): CriterionSpec[] {
  return pack.defaultCriteria.map((criterion) => ({
    ...criterion,
    origin: "suggested",
  }));
}

export function legacyCriteria(
  pack: DomainPack,
  soft: Array<{ key: string; weight: number }>,
  warnings: string[],
): CriterionSpec[] {
  const criteria: CriterionSpec[] = [];
  for (const item of soft) {
    const key = item.key.trim().toLowerCase();
    let found = pack.defaultCriteria.find(
      (criterion) =>
        criterion.key.toLowerCase() === key ||
        criterion.key.toLowerCase() === key.replace(/\s+/g, "_") ||
        criterion.label.toLowerCase() === key,
    );

    if (!found) {
      const field = pack.fields.find(
        (candidate) =>
          candidate.key.toLowerCase() === key ||
          candidate.label.toLowerCase() === key ||
          (candidate.aliases ?? []).some((alias) => alias.toLowerCase() === key),
      );
      const feature = pack.imageFeatures.find(
        (candidate) =>
          candidate.key.toLowerCase() === key ||
          candidate.label.toLowerCase() === key ||
          (candidate.aliases ?? []).some((alias) => alias.toLowerCase() === key),
      );
      const canonical = field?.key ?? feature?.key;
      if (canonical) {
        found = pack.defaultCriteria.find(
          (criterion) => criterion.key === canonical,
        );
        if (!found && feature) {
          criteria.push({
            ...criterionFromImageFeature(feature, item.weight),
            origin: "explicit",
          });
          continue;
        }
      }
    }

    if (!found) {
      warnings.push(`legacy criterion "${item.key}" is not in the ${pack.id} pack`);
      continue;
    }
    criteria.push({
      ...found,
      weight: clamp01(item.weight),
      origin: "explicit",
    });
  }
  return criteria;
}

export function criterionFromImageFeature(
  feature: ImageFeatureDef,
  weight = 0.5,
): CriterionSpec {
  const normalizer: Normalizer =
    feature.kind === "boolean"
      ? { type: "boolean" }
      : feature.kind === "enum"
        ? {
            type: "enum",
            scores: Object.fromEntries(
              (feature.options ?? []).map((option, index, options) => [
                option,
                options.length <= 1 ? 1 : index / (options.length - 1),
              ]),
            ),
          }
        : { type: "higher-is-better", max: 1 };
  return {
    key: slugifyKey(feature.key),
    label: feature.label,
    weight: clamp01(weight),
    kind: feature.kind,
    normalizer,
    source: {
      type: "image",
      prompt: feature.prompt,
      ...(feature.options ? { options: feature.options } : {}),
    },
    origin: "explicit",
  };
}
