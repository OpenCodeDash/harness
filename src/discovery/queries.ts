import type { Brief } from "../brief/types.ts";
import type {
  CriterionSpec,
  DomainPack,
  HardPredicate,
  QueryTemplate,
} from "../domain/types.ts";

export type QueryValues = Record<string, string>;

function bedroomsLabel(
  bedrooms: { min?: number; max?: number } | undefined,
): string {
  if (!bedrooms) return "";
  if (bedrooms.min !== undefined && bedrooms.max !== undefined) {
    return bedrooms.min === bedrooms.max
      ? String(bedrooms.min)
      : `${bedrooms.min}-${bedrooms.max}`;
  }
  if (bedrooms.min !== undefined) return `${bedrooms.min}+`;
  if (bedrooms.max !== undefined) return `up to ${bedrooms.max}`;
  return "";
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function predicateValue(hard: HardPredicate | undefined): string {
  if (!hard) return "";
  switch (hard.op) {
    case "eq":
      return stringValue(hard.value);
    case "lte":
      return String(hard.value);
    case "gte":
      return String(hard.value);
    case "range":
      if (hard.max !== undefined) return String(hard.max);
      if (hard.min !== undefined) return String(hard.min);
      return "";
    case "in":
      return stringValue(hard.values[0]);
  }
}

const PRICE_FIELDS = new Set(["price", "rent", "cost"]);

function priceValue(brief: Brief): string {
  if (brief.hard.rentMax !== undefined) return String(brief.hard.rentMax);

  for (const [key, value] of Object.entries(brief.hard.required ?? {})) {
    if (!PRICE_FIELDS.has(key)) continue;
    const text = stringValue(value);
    if (text) return text;
  }

  for (const criterion of brief.criteria) {
    if (criterion.source.type !== "field") continue;
    if (!PRICE_FIELDS.has(criterion.source.field)) continue;
    const value = predicateValue(criterion.hard);
    if (value) return value;
  }
  return "";
}

function fieldPredicates(brief: Brief): QueryValues {
  const values: QueryValues = {};
  for (const criterion of brief.criteria) {
    if (criterion.source.type !== "field") continue;
    const value = predicateValue(criterion.hard);
    if (value && values[criterion.source.field] === undefined) {
      values[criterion.source.field] = value;
    }
  }
  return values;
}

function criteriaTerms(criteria: CriterionSpec[]): string {
  return criteria
    .filter((criterion) => criterion.origin === "explicit")
    .map((criterion) => criterion.label)
    .join(" ");
}

export function buildQueryValues(
  brief: Brief,
  area = "",
): QueryValues {
  const hard = brief.hard.required ?? {};
  const values: QueryValues = {
    area,
    prompt: brief.prompt,
    keywords: criteriaTerms(brief.criteria),
    bedrooms: bedroomsLabel(brief.hard.bedrooms),
    rent: brief.hard.rentMax !== undefined ? `under ${brief.hard.rentMax}` : "",
    price: priceValue(brief),
    property_type: stringValue(hard.property_type),
    ...fieldPredicates(brief),
  };

  for (const [key, value] of Object.entries(hard)) {
    const text = stringValue(value);
    if (text) values[key] = text;
  }
  return values;
}

export function renderTemplate(
  template: string,
  values: QueryValues,
): string {
  const rendered = template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    return values[key] ?? "";
  });
  return rendered.replace(/\s+/g, " ").trim();
}

function normaliseTemplate(
  template: string | QueryTemplate,
): QueryTemplate {
  return typeof template === "string" ? { template } : template;
}

export interface QueryOptions {
  /** Recipe ids available for extraction. Source-tagged templates are skipped when absent. */
  sources?: string[];
}

export function buildDiscoveryQueries(
  brief: Brief,
  pack: DomainPack,
  options: QueryOptions = {},
): string[] {
  const areas = brief.hard.areas?.length ? brief.hard.areas : [""];
  const available = options.sources ? new Set(options.sources) : null;
  const queries = new Set<string>();

  for (const area of areas) {
    const values = buildQueryValues(brief, area);
    for (const raw of pack.queryTemplates) {
      const template = normaliseTemplate(raw);
      if (template.source && available && !available.has(template.source)) {
        continue;
      }
      let query = renderTemplate(template.template, values);
      if (template.site && !/site:/i.test(query)) {
        query = `site:${template.site} ${query}`.trim();
      }
      if (query.length >= 3) queries.add(query);
    }
  }
  return [...queries];
}
