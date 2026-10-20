import type { DomainPack, FieldDef } from "./types.ts";

export const GENERIC_FIELDS: FieldDef[] = [
  { key: "title", label: "Title", kind: "text" },
  { key: "description", label: "Description", kind: "text" },
  {
    key: "price",
    label: "Price",
    kind: "number",
    hard: true,
    aliases: ["cost", "asking price"],
  },
  { key: "currency", label: "Currency", kind: "text" },
  {
    key: "brand",
    label: "Brand / make",
    kind: "text",
    aliases: ["make", "manufacturer"],
  },
  { key: "model", label: "Model", kind: "text" },
  { key: "year", label: "Year", kind: "number" },
  {
    key: "mileage",
    label: "Mileage (km)",
    kind: "number",
    aliases: ["odometer", "km", "kilometres"],
  },
  {
    key: "condition",
    label: "Condition",
    kind: "enum",
    options: ["new", "refurbished", "used", "damaged"],
  },
  { key: "color", label: "Colour", kind: "text", aliases: ["colour"] },
  { key: "address", label: "Address", kind: "text" },
  {
    key: "location",
    label: "Location",
    kind: "text",
    aliases: ["area", "suburb"],
  },
  { key: "lat", label: "Latitude", kind: "number" },
  { key: "lon", label: "Longitude", kind: "number" },
  { key: "availability", label: "Availability", kind: "text" },
  { key: "seller", label: "Seller", kind: "text" },
];

/** Generic fields plus the pack's fields, with pack definitions taking precedence. */
export function allFields(pack?: DomainPack): FieldDef[] {
  const byKey = new Map(GENERIC_FIELDS.map((field) => [field.key, field]));
  for (const field of pack?.fields ?? []) byKey.set(field.key, field);
  return [...byKey.values()];
}

export const genericPack: DomainPack = {
  id: "generic",
  label: "Generic listings",
  fields: GENERIC_FIELDS,
  imageFeatures: [],
  defaultCriteria: [
    {
      key: "price",
      label: "Price",
      weight: 0.6,
      kind: "number",
      normalizer: { type: "lower-is-better", max: 100_000 },
      source: { type: "field", field: "price" },
      origin: "suggested",
    },
    {
      key: "condition",
      label: "Condition",
      weight: 0.5,
      kind: "enum",
      normalizer: {
        type: "enum",
        scores: { damaged: 0, used: 0.6, refurbished: 0.75, new: 1 },
      },
      source: { type: "field", field: "condition" },
      origin: "suggested",
    },
  ],
};
