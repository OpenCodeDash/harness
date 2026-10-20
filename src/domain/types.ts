export type ValueKind = "boolean" | "number" | "enum" | "text";

export type Normalizer =
  | { type: "boolean" }
  | { type: "lower-is-better"; max: number }
  | { type: "higher-is-better"; max: number }
  | { type: "range"; min: number; max: number }
  | { type: "enum"; scores: Record<string, number> };

export interface Criterion {
  key: string;
  label: string;
  weight: number;
  kind: ValueKind;
  normalizer: Normalizer;
  unknown?: "flag" | "penalize";
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
  defaultCriteria: Criterion[];
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
