import type { DomainPack } from "./types.ts";

export const carsPack: DomainPack = {
  id: "cars",
  label: "Cars / vehicles",
  fields: [
    { key: "price", label: "Price", kind: "number", hard: true },
    {
      key: "brand",
      label: "Make",
      kind: "text",
      aliases: ["make", "manufacturer"],
    },
    { key: "model", label: "Model", kind: "text" },
    { key: "year", label: "Year", kind: "number" },
    {
      key: "mileage",
      label: "Odometer (km)",
      kind: "number",
      aliases: ["odometer", "km", "kilometres"],
    },
    {
      key: "body_type",
      label: "Body type",
      kind: "enum",
      options: ["sedan", "hatchback", "suv", "ute", "wagon", "coupe", "van"],
      aliases: ["body", "style"],
    },
    {
      key: "fuel_type",
      label: "Fuel",
      kind: "enum",
      options: ["petrol", "diesel", "hybrid", "electric", "lpg"],
      aliases: ["fuel"],
    },
    {
      key: "transmission",
      label: "Transmission",
      kind: "enum",
      options: ["automatic", "manual"],
      aliases: ["gearbox"],
    },
    {
      key: "condition",
      label: "Condition",
      kind: "enum",
      options: ["new", "used", "damaged", "refurbished"],
    },
    { key: "color", label: "Colour", kind: "text", aliases: ["colour"] },
    { key: "location", label: "Location", kind: "text", aliases: ["area"] },
    { key: "address", label: "Address", kind: "text" },
    { key: "title", label: "Title", kind: "text" },
    { key: "description", label: "Description", kind: "text" },
  ],
  imageFeatures: [
    {
      key: "exterior_condition",
      label: "Exterior condition",
      prompt:
        "Judge the visible exterior condition: paint, panels, and trim. Answer poor, fair, good, or excellent.",
      kind: "enum",
      options: ["poor", "fair", "good", "excellent"],
    },
    {
      key: "rust",
      label: "Rust",
      prompt: "Is visible rust or corrosion present on the body or sills?",
      kind: "boolean",
      aliases: ["corrosion"],
    },
    {
      key: "panel_damage",
      label: "Panel damage",
      prompt:
        "Are dents, scratches, or misaligned panels visible? Answer true only when damage is clear.",
      kind: "boolean",
      aliases: ["dents", "damage"],
    },
    {
      key: "tyres",
      label: "Tyres",
      prompt:
        "Judge visible tyre tread depth. Answer worn, fair, or good.",
      kind: "enum",
      options: ["worn", "fair", "good"],
    },
    {
      key: "interior_condition",
      label: "Interior condition",
      prompt:
        "Judge the visible interior: seats, dashboard, and trim. Answer poor, fair, or good.",
      kind: "enum",
      options: ["poor", "fair", "good"],
    },
    {
      key: "warning_lights",
      label: "Warning lights",
      prompt:
        "Are any dashboard warning lights illuminated in the photo? Answer true only when clearly visible.",
      kind: "boolean",
      aliases: ["engine light", "dashboard warning"],
    },
  ],
  defaultCriteria: [
    {
      key: "price",
      label: "Price",
      weight: 0.8,
      kind: "number",
      normalizer: { type: "lower-is-better", max: 30_000 },
      source: { type: "field", field: "price" },
      origin: "suggested",
    },
    {
      key: "mileage",
      label: "Mileage",
      weight: 0.7,
      kind: "number",
      normalizer: { type: "lower-is-better", max: 200_000 },
      source: { type: "field", field: "mileage" },
      origin: "suggested",
    },
    {
      key: "year",
      label: "Year",
      weight: 0.5,
      kind: "number",
      normalizer: { type: "higher-is-better", max: 2025 },
      source: { type: "field", field: "year" },
      origin: "suggested",
    },
    {
      key: "condition",
      label: "Condition",
      weight: 0.5,
      kind: "enum",
      normalizer: {
        type: "enum",
        scores: { damaged: 0, used: 0.6, refurbished: 0.7, new: 1 },
      },
      source: { type: "field", field: "condition" },
      origin: "suggested",
    },
    {
      key: "fuel_type",
      label: "Fuel",
      weight: 0.4,
      kind: "enum",
      normalizer: {
        type: "enum",
        scores: {
          diesel: 0.5,
          petrol: 0.6,
          lpg: 0.5,
          hybrid: 0.9,
          electric: 1,
        },
      },
      source: { type: "field", field: "fuel_type" },
      origin: "suggested",
    },
    {
      key: "exterior_condition",
      label: "Exterior condition",
      weight: 0.5,
      kind: "enum",
      normalizer: {
        type: "enum",
        scores: { poor: 0, fair: 0.4, good: 0.75, excellent: 1 },
      },
      source: {
        type: "image",
        prompt:
          "Judge the visible exterior condition: paint, panels, and trim. Answer poor, fair, good, or excellent.",
        options: ["poor", "fair", "good", "excellent"],
      },
      origin: "suggested",
    },
    {
      key: "service_history",
      label: "Service history",
      weight: 0.6,
      kind: "boolean",
      normalizer: { type: "boolean" },
      source: {
        type: "text",
        prompt:
          "Does the description state that the vehicle has service history, a recent service, or a current warrant of fitness?",
      },
      origin: "suggested",
    },
    {
      key: "panel_damage",
      label: "Panel damage",
      weight: 0.6,
      kind: "boolean",
      normalizer: { type: "boolean", prefer: false },
      source: {
        type: "image",
        prompt:
          "Are dents, scratches, or misaligned panels visible? Answer true only when damage is clear.",
      },
      origin: "suggested",
    },
  ],
};
