import type { DomainPack } from "./types.ts";

export const propertyPack: DomainPack = {
  id: "property",
  label: "Property / rentals",
  fields: [
    { key: "rent", label: "Rent per week", kind: "number", hard: true },
    { key: "bedrooms", label: "Bedrooms", kind: "number", hard: true },
    { key: "bathrooms", label: "Bathrooms", kind: "number" },
    { key: "address", label: "Address", kind: "text" },
    { key: "suburb", label: "Suburb", kind: "text" },
    {
      key: "property_type",
      label: "Property type",
      kind: "enum",
      options: ["apartment", "house", "townhouse", "unit", "studio"],
    },
    {
      key: "parking",
      label: "Parking",
      kind: "boolean",
      aliases: ["carpark", "car park", "garage"],
    },
    { key: "furnished", label: "Furnished", kind: "boolean" },
    {
      key: "pets",
      label: "Pets",
      kind: "enum",
      options: ["yes", "no", "negotiable"],
    },
    { key: "available_from", label: "Available from", kind: "text" },
    { key: "floor_area", label: "Floor area (m2)", kind: "number" },
    {
      key: "commute",
      label: "Drive time to anchor (min)",
      kind: "number",
      derived: true,
    },
  ],
  imageFeatures: [
    {
      key: "heat_pump",
      label: "Heat pump",
      prompt:
        "Is a heat pump or air-conditioning unit visible? Answer present, absent, or unknown.",
      kind: "boolean",
      aliases: ["aircon", "air conditioning", "hvac"],
    },
    {
      key: "sunlight",
      label: "Sunlight",
      prompt:
        "Judge direct sunlight and window size visible in the photo. Answer none, low, moderate, or high. Do not infer time of day.",
      kind: "enum",
      options: ["none", "low", "moderate", "high"],
      aliases: ["sun", "sunny", "light"],
    },
    {
      key: "condition",
      label: "Condition",
      prompt:
        "Judge the visible condition of walls, floors, kitchen, and bathroom. Answer poor, fair, good, or renovated.",
      kind: "enum",
      options: ["poor", "fair", "good", "renovated"],
    },
    { key: "carpet", label: "Carpet", prompt: "Is carpet visible?", kind: "boolean" },
    {
      key: "appliances",
      label: "Appliances",
      prompt: "Are whiteware appliances (fridge, oven, washer) visible?",
      kind: "boolean",
    },
    {
      key: "outdoor_space",
      label: "Outdoor space",
      prompt: "Is a balcony, deck, or private outdoor space visible?",
      kind: "boolean",
    },
    {
      key: "damp_signs",
      label: "Damp signs",
      prompt: "Are there visible signs of damp, mould, or water damage?",
      kind: "boolean",
      aliases: ["mould", "mold", "damp", "water damage"],
    },
  ],
  defaultCriteria: [
    {
      key: "parking",
      label: "Parking",
      weight: 0.7,
      kind: "boolean",
      normalizer: { type: "boolean" },
      source: { type: "field", field: "parking" },
      origin: "suggested",
    },
    {
      key: "commute",
      label: "Commute",
      weight: 0.8,
      kind: "number",
      normalizer: { type: "lower-is-better", max: 45 },
      source: { type: "derived", evaluator: "commute" },
      origin: "suggested",
    },
    {
      key: "sunlight",
      label: "Sunlight",
      weight: 0.6,
      kind: "enum",
      normalizer: {
        type: "enum",
        scores: { none: 0, low: 0.33, moderate: 0.66, high: 1 },
      },
      source: {
        type: "image",
        prompt:
          "Judge direct sunlight and window size visible in the photo. Answer none, low, moderate, or high. Do not infer time of day.",
        options: ["none", "low", "moderate", "high"],
      },
      origin: "suggested",
    },
    {
      key: "heat_pump",
      label: "Heat pump",
      weight: 0.5,
      kind: "boolean",
      normalizer: { type: "boolean" },
      source: {
        type: "image",
        prompt:
          "Is a heat pump or air-conditioning unit visible? Answer present, absent, or unknown.",
      },
      origin: "suggested",
    },
    {
      key: "condition",
      label: "Condition",
      weight: 0.4,
      kind: "enum",
      normalizer: {
        type: "enum",
        scores: { poor: 0, fair: 0.33, good: 0.66, renovated: 1 },
      },
      source: {
        type: "image",
        prompt:
          "Judge the visible condition of walls, floors, kitchen, and bathroom. Answer poor, fair, good, or renovated.",
        options: ["poor", "fair", "good", "renovated"],
      },
      origin: "suggested",
    },
    {
      key: "bedrooms",
      label: "Bedroom fit",
      weight: 0.3,
      kind: "number",
      normalizer: { type: "range", min: 2, max: 3 },
      source: { type: "field", field: "bedrooms" },
      origin: "suggested",
    },
  ],
};
