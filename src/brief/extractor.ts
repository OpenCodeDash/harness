import type { DomainPack } from "../domain/types.ts";
import type { ResponsesClient } from "../vision/responses.ts";
import type { BriefExtractor } from "./brief.ts";

interface Extraction {
  hard?: {
    rent_max?: number | null;
    bedrooms?: { min?: number | null; max?: number | null } | null;
    areas?: string[] | null;
    required?: Array<{ key: string; value: string | number | boolean }> | null;
  } | null;
  anchors?: {
    work?: { address?: string | null; lat?: number | null; lon?: number | null } | null;
    commute?: {
      mode?: string | null;
      max_minutes?: number | null;
      hard?: boolean | null;
    } | null;
  } | null;
  soft?: Array<{ key: string; weight: number }> | null;
  unknown_policy?: string | null;
  budgets?: {
    max_listings?: number | null;
    max_usd?: number | null;
    max_minutes?: number | null;
    vision_max?: number | null;
  } | null;
  assumptions?: string[] | null;
}

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(stripNulls)
      .filter((entry) => entry !== null && entry !== undefined);
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const cleaned = stripNulls(entry);
      if (cleaned === null || cleaned === undefined) continue;
      if (Array.isArray(cleaned) && cleaned.length === 0) continue;
      if (
        typeof cleaned === "object" &&
        !Array.isArray(cleaned) &&
        Object.keys(cleaned).length === 0
      ) {
        continue;
      }
      result[key] = cleaned;
    }
    return result;
  }
  return value;
}

function buildExtractionSchema(pack: DomainPack): Record<string, unknown> {
  const nullable = (schema: Record<string, unknown>) => ({
    anyOf: [schema, { type: "null" }],
  });
  const number = { type: "number" };

  return {
    type: "object",
    properties: {
      hard: {
        type: "object",
        properties: {
          rent_max: nullable(number),
          bedrooms: nullable({
            type: "object",
            properties: {
              min: nullable({ type: "number" }),
              max: nullable({ type: "number" }),
            },
            required: ["min", "max"],
            additionalProperties: false,
          }),
          areas: nullable({ type: "array", items: { type: "string" } }),
          required: nullable({
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string" },
                value: {
                  anyOf: [
                    { type: "string" },
                    { type: "number" },
                    { type: "boolean" },
                  ],
                },
              },
              required: ["key", "value"],
              additionalProperties: false,
            },
          }),
        },
        required: ["rent_max", "bedrooms", "areas", "required"],
        additionalProperties: false,
      },
      anchors: {
        type: "object",
        properties: {
          work: nullable({
            type: "object",
            properties: {
              address: nullable({ type: "string" }),
              lat: nullable({ type: "number" }),
              lon: nullable({ type: "number" }),
            },
            required: ["address", "lat", "lon"],
            additionalProperties: false,
          }),
          commute: nullable({
            type: "object",
            properties: {
              mode: nullable({
                type: "string",
                enum: ["drive", "walk", "cycle", "transit"],
              }),
              max_minutes: nullable({ type: "number" }),
              hard: nullable({ type: "boolean" }),
            },
            required: ["mode", "max_minutes", "hard"],
            additionalProperties: false,
          }),
        },
        required: ["work", "commute"],
        additionalProperties: false,
      },
      soft: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: {
              type: "string",
              enum: pack.defaultCriteria.map((criterion) => criterion.key),
            },
            weight: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["key", "weight"],
          additionalProperties: false,
        },
      },
      unknown_policy: {
        type: "string",
        enum: ["flag", "penalize", "investigate"],
      },
      budgets: {
        type: "object",
        properties: {
          max_listings: number,
          max_usd: number,
          max_minutes: number,
          vision_max: number,
        },
        required: ["max_listings", "max_usd", "max_minutes", "vision_max"],
        additionalProperties: false,
      },
      assumptions: { type: "array", items: { type: "string" } },
    },
    required: [
      "hard",
      "anchors",
      "soft",
      "unknown_policy",
      "budgets",
      "assumptions",
    ],
    additionalProperties: false,
  };
}

export function buildBriefPrompt(prompt: string, pack: DomainPack): string {
  const criteria = pack.defaultCriteria
    .map((criterion) => `${criterion.key} (${criterion.label})`)
    .join(", ");
  const booleanFields = pack.fields
    .filter((field) => field.kind === "boolean")
    .map((field) => field.key)
    .join(", ");
  return [
    `Convert this research request into a structured brief for ${pack.label}.`,
    "Hard limits are what the user states as limits; preferences are soft weights.",
    "Do not invent numbers the user did not state. Use null when unknown.",
    `Soft criteria keys must be one of: ${criteria}.`,
    `Boolean required fields may include: ${booleanFields}.`,
    "Weights are 0 to 1. Higher means more important.",
    "Commute hard=true only if the user made it a limit.",
    "If the user did not give a commute time, omit the commute object.",
    "If the user did not give a work location, omit the work object.",
    "If the user did not state budgets, use max_listings 300, max_usd 15, max_minutes 120, vision_max 60.",
    "",
    `Request: ${prompt}`,
  ].join("\n");
}

export class ResponsesBriefExtractor implements BriefExtractor {
  constructor(
    private readonly client: ResponsesClient,
    private readonly model: string,
  ) {}

  async extract(input: {
    prompt: string;
    pack: DomainPack;
  }): Promise<unknown> {
    const result = await this.client.structured<Extraction>({
      model: this.model,
      name: "brief",
      schema: buildExtractionSchema(input.pack),
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: buildBriefPrompt(input.prompt, input.pack) },
          ],
        },
      ],
    });

    const cleaned = stripNulls(result.data) as Record<string, unknown>;
    const hard = cleaned.hard as Record<string, unknown> | undefined;
    const required = hard?.required;
    if (Array.isArray(required) && hard) {
      const map: Record<string, unknown> = {};
      for (const entry of required) {
        const pair = entry as { key?: unknown; value?: unknown };
        if (typeof pair.key === "string") map[pair.key] = pair.value;
      }
      hard.required = map;
    }

    const bedrooms = hard?.bedrooms as Record<string, unknown> | undefined;
    if (
      hard &&
      bedrooms &&
      typeof bedrooms.min !== "number" &&
      typeof bedrooms.max !== "number"
    ) {
      delete hard.bedrooms;
    }
    if (
      hard &&
      (typeof hard.rent_max !== "number" || hard.rent_max <= 0)
    ) {
      delete hard.rent_max;
    }

    const budgets = cleaned.budgets as Record<string, unknown> | undefined;
    if (budgets) {
      for (const key of ["max_listings", "max_usd", "max_minutes"]) {
        if (typeof budgets[key] !== "number" || (budgets[key] as number) <= 0) {
          delete budgets[key];
        }
      }
      const vision = budgets.vision_max;
      if (typeof vision !== "number" || vision < 0) delete budgets.vision_max;
      if (Object.keys(budgets).length === 0) delete cleaned.budgets;
    }

    const anchors = cleaned.anchors as Record<string, unknown> | undefined;
    const commute = anchors?.commute as Record<string, unknown> | undefined;
    if (anchors && commute && typeof commute.max_minutes !== "number") {
      delete anchors.commute;
    }
    const work = anchors?.work as Record<string, unknown> | undefined;
    if (
      anchors &&
      work &&
      typeof work.address !== "string" &&
      !(typeof work.lat === "number" && typeof work.lon === "number")
    ) {
      delete anchors.work;
    }

    return cleaned;
  }
}
