import type { Brief } from "../brief/types.ts";
import type { DomainPack } from "../domain/types.ts";

export interface QueryValues {
  area: string;
  bedrooms: string;
  rent: string;
  property_type: string;
}

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

export function renderTemplate(template: string, values: QueryValues): string {
  const rendered = template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    return values[key as keyof QueryValues] ?? "";
  });
  return rendered.replace(/\s+/g, " ").trim();
}

export function buildDiscoveryQueries(
  brief: Brief,
  pack: DomainPack,
): string[] {
  const areas = brief.hard.areas?.length ? brief.hard.areas : [""];
  const base: Omit<QueryValues, "area"> = {
    bedrooms: bedroomsLabel(brief.hard.bedrooms),
    rent: brief.hard.rentMax !== undefined ? `under ${brief.hard.rentMax}` : "",
    property_type:
      typeof brief.hard.required?.property_type === "string"
        ? brief.hard.required.property_type
        : "",
  };

  const queries = new Set<string>();
  for (const area of areas) {
    for (const template of pack.queryTemplates) {
      const query = renderTemplate(template, { ...base, area });
      if (query.length >= 3) queries.add(query);
    }
  }
  return [...queries];
}
