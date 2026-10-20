export type ValueKind = "boolean" | "number" | "enum" | "text";

export type Normalizer =
  | { type: "boolean"; prefer?: boolean }
  | { type: "lower-is-better"; max: number }
  | { type: "higher-is-better"; max: number }
  | { type: "range"; min: number; max: number }
  | { type: "enum"; scores: Record<string, number> };

export type CriterionKind = "boolean" | "number" | "enum";

export type DerivedEvaluator =
  | "commute"
  | "price_per_bedroom"
  | "price_per_bathroom";

export const DERIVED_EVALUATORS: readonly DerivedEvaluator[] = [
  "commute",
  "price_per_bedroom",
  "price_per_bathroom",
];

export type CriterionSource =
  | { type: "field"; field: string }
  | { type: "text"; prompt: string }
  | { type: "image"; prompt: string; options?: string[] }
  | {
      type: "derived";
      evaluator: DerivedEvaluator;
      params?: Record<string, unknown>;
    };

export type HardPredicate =
  | { op: "eq"; value: unknown }
  | { op: "in"; values: unknown[] }
  | { op: "lte"; value: number }
  | { op: "gte"; value: number }
  | { op: "range"; min?: number; max?: number };

export interface CriterionSpec {
  key: string;
  label: string;
  weight: number;
  kind: CriterionKind;
  normalizer: Normalizer;
  source: CriterionSource;
  origin: "explicit" | "suggested";
  hard?: HardPredicate;
  unknown?: "flag" | "penalize";
  rationale?: string;
}

export type Criterion = CriterionSpec;

export function criterionFactKey(criterion: CriterionSpec): string {
  return criterion.source.type === "field"
    ? criterion.source.field
    : criterion.key;
}

export interface FieldDef {
  key: string;
  label: string;
  kind: ValueKind;
  hard?: boolean;
  derived?: boolean;
  options?: string[];
  aliases?: string[];
}

export interface ImageFeatureDef {
  key: string;
  label: string;
  prompt: string;
  kind: "boolean" | "enum" | "number";
  options?: string[];
  aliases?: string[];
}

export interface DomainPack {
  id: string;
  label: string;
  fields: FieldDef[];
  imageFeatures: ImageFeatureDef[];
  defaultCriteria: CriterionSpec[];
  queryTemplates: string[];
}

export function findField(
  pack: DomainPack,
  key: string,
): FieldDef | undefined {
  return pack.fields.find((field) => field.key === key);
}

export function findImageFeature(
  pack: DomainPack,
  key: string,
): ImageFeatureDef | undefined {
  return pack.imageFeatures.find((feature) => feature.key === key);
}
