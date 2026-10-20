import type { DomainPack } from "./types.ts";

export const laptopsPack: DomainPack = {
  id: "laptops",
  label: "Laptops / computers",
  fields: [
    { key: "price", label: "Price", kind: "number", hard: true },
    {
      key: "brand",
      label: "Brand",
      kind: "text",
      aliases: ["make", "manufacturer"],
    },
    { key: "model", label: "Model", kind: "text" },
    { key: "cpu", label: "CPU", kind: "text", aliases: ["processor", "chip"] },
    {
      key: "ram_gb",
      label: "RAM (GB)",
      kind: "number",
      aliases: ["ram", "memory"],
    },
    {
      key: "storage_gb",
      label: "Storage (GB)",
      kind: "number",
      aliases: ["storage", "ssd", "hdd"],
    },
    {
      key: "screen_inches",
      label: "Screen (inches)",
      kind: "number",
      aliases: ["screen", "display"],
    },
    { key: "gpu", label: "GPU", kind: "text", aliases: ["graphics"] },
    {
      key: "condition",
      label: "Condition",
      kind: "enum",
      options: ["new", "used", "refurbished", "damaged"],
    },
    { key: "year", label: "Year", kind: "number" },
    { key: "location", label: "Location", kind: "text", aliases: ["area"] },
    { key: "address", label: "Address", kind: "text" },
    { key: "title", label: "Title", kind: "text" },
    { key: "description", label: "Description", kind: "text" },
  ],
  imageFeatures: [
    {
      key: "physical_condition",
      label: "Physical condition",
      prompt:
        "Judge the visible condition of the laptop body, lid, and edges. Answer poor, fair, good, or excellent.",
      kind: "enum",
      options: ["poor", "fair", "good", "excellent"],
    },
    {
      key: "screen_damage",
      label: "Screen damage",
      prompt:
        "Are cracks, dead pixels, or pressure marks visible on the screen? Answer true only when clear.",
      kind: "boolean",
      aliases: ["cracked screen", "dead pixels"],
    },
    {
      key: "keyboard_wear",
      label: "Keyboard wear",
      prompt:
        "Is visible wear, shine, or missing keycaps present on the keyboard?",
      kind: "boolean",
      aliases: ["key wear"],
    },
    {
      key: "ports",
      label: "Ports",
      prompt:
        "Are the advertised ports (USB, HDMI, charging) visible and intact? Answer true, false, or unknown is not allowed: answer true only when ports are shown.",
      kind: "boolean",
    },
    {
      key: "charger_included",
      label: "Charger shown",
      prompt: "Is a charger or power adapter visible in the photos?",
      kind: "boolean",
      aliases: ["power adapter", "psu"],
    },
  ],
  defaultCriteria: [
    {
      key: "price",
      label: "Price",
      weight: 0.8,
      kind: "number",
      normalizer: { type: "lower-is-better", max: 3_000 },
      source: { type: "field", field: "price" },
      origin: "suggested",
    },
    {
      key: "ram_gb",
      label: "RAM",
      weight: 0.7,
      kind: "number",
      normalizer: { type: "higher-is-better", max: 32 },
      source: { type: "field", field: "ram_gb" },
      origin: "suggested",
    },
    {
      key: "storage_gb",
      label: "Storage",
      weight: 0.5,
      kind: "number",
      normalizer: { type: "higher-is-better", max: 1_024 },
      source: { type: "field", field: "storage_gb" },
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
    {
      key: "screen_inches",
      label: "Screen size",
      weight: 0.3,
      kind: "number",
      normalizer: { type: "range", min: 13, max: 16 },
      source: { type: "field", field: "screen_inches" },
      origin: "suggested",
    },
    {
      key: "battery_health",
      label: "Battery health",
      weight: 0.6,
      kind: "number",
      normalizer: { type: "higher-is-better", max: 100 },
      source: {
        type: "text",
        prompt:
          "What is the stated battery health as a percentage? Return null when only a cycle count or nothing is stated.",
      },
      origin: "suggested",
    },
    {
      key: "physical_condition",
      label: "Physical condition",
      weight: 0.5,
      kind: "enum",
      normalizer: {
        type: "enum",
        scores: { poor: 0, fair: 0.4, good: 0.75, excellent: 1 },
      },
      source: {
        type: "image",
        prompt:
          "Judge the visible condition of the laptop body, lid, and edges. Answer poor, fair, good, or excellent.",
        options: ["poor", "fair", "good", "excellent"],
      },
      origin: "suggested",
    },
    {
      key: "screen_damage",
      label: "Screen damage",
      weight: 0.7,
      kind: "boolean",
      normalizer: { type: "boolean", prefer: false },
      source: {
        type: "image",
        prompt:
          "Are cracks, dead pixels, or pressure marks visible on the screen? Answer true only when clear.",
      },
      origin: "suggested",
    },
  ],
};
