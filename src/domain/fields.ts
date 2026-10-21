import type { FieldDef } from "./types.ts";

/**
 * Canonical field vocabulary emitted by the structured-data and generic page
 * extractors. This is not a domain preset: every brief may use any of these
 * keys, and a missing key is reported as an evidence gap, never a hard error.
 */
export const FIELDS: FieldDef[] = [
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

export function findField(key: string): FieldDef | undefined {
  return FIELDS.find((field) => field.key === key);
}

/** Map a user-facing field name, alias, or label to a canonical field key. */
export function resolveFieldKey(value: string): string | null {
  const target = value.trim().toLowerCase();
  const found = FIELDS.find(
    (field) =>
      field.key.toLowerCase() === target ||
      field.key.toLowerCase() === target.replace(/\s+/g, "_") ||
      field.label.toLowerCase() === target ||
      (field.aliases ?? []).some((alias) => alias.toLowerCase() === target),
  );
  return found?.key ?? null;
}
