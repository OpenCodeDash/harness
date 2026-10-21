import { FIELDS } from "../domain/fields.ts";
import type { ResponsesClient } from "../vision/responses.ts";
import type { BriefExtractor } from "./brief.ts";

const CRITERION_SOURCE_SCHEMA = {
  anyOf: [
    {
      type: "object",
      properties: {
        type: { type: "string", const: "field" },
        field: { type: "string" },
      },
      required: ["type", "field"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "text" },
        prompt: { type: "string" },
      },
      required: ["type", "prompt"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "image" },
        prompt: { type: "string" },
        options: {
          anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }],
        },
      },
      required: ["type", "prompt", "options"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "derived" },
        evaluator: {
          type: "string",
          enum: ["commute", "price_per_bedroom", "price_per_bathroom"],
        },
      },
      required: ["type", "evaluator"],
      additionalProperties: false,
    },
  ],
} as const;

const NORMALIZER_SCHEMA = {
  anyOf: [
    {
      type: "object",
      properties: {
        type: { type: "string", const: "boolean" },
        prefer: { anyOf: [{ type: "boolean" }, { type: "null" }] },
      },
      required: ["type", "prefer"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "lower-is-better" },
        max: { type: "number" },
      },
      required: ["type", "max"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "higher-is-better" },
        max: { type: "number" },
      },
      required: ["type", "max"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "range" },
        min: { type: "number" },
        max: { type: "number" },
      },
      required: ["type", "min", "max"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "enum" },
        scores: {
          type: "array",
          items: {
            type: "object",
            properties: {
              value: { type: "string" },
              score: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["value", "score"],
            additionalProperties: false,
          },
        },
      },
      required: ["type", "scores"],
      additionalProperties: false,
    },
  ],
} as const;

const HARD_SCHEMA = {
  anyOf: [
    {
      type: "object",
      properties: {
        op: { type: "string", const: "eq" },
        value: {
          anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
        },
      },
      required: ["op", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", const: "in" },
        values: {
          type: "array",
          items: {
            anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
          },
        },
      },
      required: ["op", "values"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", const: "lte" },
        value: { type: "number" },
      },
      required: ["op", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", const: "gte" },
        value: { type: "number" },
      },
      required: ["op", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", const: "range" },
        min: { anyOf: [{ type: "number" }, { type: "null" }] },
        max: { anyOf: [{ type: "number" }, { type: "null" }] },
      },
      required: ["op", "min", "max"],
      additionalProperties: false,
    },
    { type: "null" },
  ],
} as const;

const CRITERION_SCHEMA = {
  type: "object",
  properties: {
    key: { type: "string" },
    label: { type: "string" },
    weight: { type: "number", minimum: 0, maximum: 1 },
    kind: { type: "string", enum: ["boolean", "number", "enum"] },
    normalizer: NORMALIZER_SCHEMA,
    source: CRITERION_SOURCE_SCHEMA,
    origin: { type: "string", enum: ["explicit", "suggested"] },
    hard: HARD_SCHEMA,
    unknown: {
      anyOf: [
        { type: "string", enum: ["flag", "penalize"] },
        { type: "null" },
      ],
    },
    rationale: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: [
    "key",
    "label",
    "weight",
    "kind",
    "normalizer",
    "source",
    "origin",
    "hard",
    "unknown",
    "rationale",
  ],
  additionalProperties: false,
} as const;

function nullable(schema: Record<string, unknown>): Record<string, unknown> {
  return { anyOf: [schema, { type: "null" }] };
}

function buildExtractionSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      hard: {
        type: "object",
        properties: {
          rent_max: nullable({ type: "number" }),
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
      criteria: {
        type: "array",
        maxItems: 14,
        items: CRITERION_SCHEMA,
      },
      unknown_policy: {
        type: "string",
        enum: ["flag", "penalize", "investigate"],
      },
      sources: {
        type: "object",
        properties: {
          allow: nullable({ type: "array", items: { type: "string" } }),
          deny: nullable({ type: "array", items: { type: "string" } }),
          prefer: nullable({ type: "array", items: { type: "string" } }),
          web: nullable({
            type: "string",
            enum: ["open", "structured-only", "off"],
          }),
        },
        required: ["allow", "deny", "prefer", "web"],
        additionalProperties: false,
      },
      budgets: {
        type: "object",
        properties: {
          max_listings: { type: "number" },
          max_usd: { type: "number" },
          max_minutes: { type: "number" },
          vision_max: { type: "number" },
          html_max: { type: "number" },
        },
        required: ["max_listings", "max_usd", "max_minutes", "vision_max", "html_max"],
        additionalProperties: false,
      },
      assumptions: { type: "array", items: { type: "string" } },
    },
    required: [
      "hard",
      "anchors",
      "criteria",
      "unknown_policy",
      "sources",
      "budgets",
      "assumptions",
    ],
    additionalProperties: false,
  };
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

export function buildBriefPrompt(prompt: string): string {
  const fields = FIELDS.map(
    (field) => `- ${field.key} (${field.label}, ${field.kind})`,
  ).join("\n");

  return [
    "Convert this research request into a brief.",
    "",
    "Rules:",
    "- Extract every criterion the user explicitly asks for, including hard limits.",
    "- Then propose additional criteria that are genuinely useful for this request. Do not pad: typically 3-8 suggestions, never a long list.",
    "- Each criterion must define how it is evaluated:",
    "  - field: structured listing data; use one of the available field keys.",
    "  - text: the listing description; write a precise extraction prompt.",
    "  - image: listing photos; write a precise visual prompt and options for enums.",
    "  - derived: one of commute, price_per_bedroom, price_per_bathroom.",
    "- kind must match the normalizer: boolean -> boolean; number -> lower-is-better/higher-is-better/range; enum -> enum scores.",
    "- Normalizers encode preference: for a bad thing (damp, mould), boolean prefer must be false.",
    "- Mark origin explicit for things the user asked for and suggested for your additions.",
    "- Suggested criteria must not have hard constraints. Hard constraints only come from stated limits.",
    "- Use rent_max/bedrooms/areas only when the request is about property rentals. Otherwise express limits as hard predicates on the relevant criterion (for example price with op lte).",
    "- If the request mentions work or \"near work\", set anchors.work.address to the best available place name (e.g. \"Wellington CBD\") so commute can be computed.",
    "- Use field sources only for the available fields. For anything else, use text/image facts.",
    "- Only set sources when the user names sites or limits the search. allow/deny/prefer take source ids or hosts (for example trademe or trademe.co.nz). web defaults to open; use structured-only to skip generic HTML and off to search only allow-listed sources.",
    "- Weights are 0..1. Explicit criteria should carry the user's intent; suggested criteria default lower.",
    "- Do not invent facts. Criteria are what to look for; evidence comes later.",
    "",
    "Available fields:",
    fields || "(none)",
    "",
    "Derived evaluators: commute, price_per_bedroom, price_per_bathroom.",
    "",
    `Request: ${prompt}`,
  ].join("\n");
}

export class ResponsesBriefExtractor implements BriefExtractor {
  constructor(
    private readonly client: ResponsesClient,
    private readonly model: string,
  ) {}

  async extract(input: { prompt: string }): Promise<unknown> {
    const result = await this.client.structured<Record<string, unknown>>({
      model: this.model,
      name: "brief",
      schema: buildExtractionSchema(),
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: buildBriefPrompt(input.prompt) }],
        },
      ],
    });

    const cleaned = stripNulls(result.data) as {
      criteria?: Array<Record<string, unknown>>;
      hard?: Record<string, unknown>;
      budgets?: Record<string, unknown>;
      anchors?: Record<string, Record<string, unknown>>;
    };

    if (Array.isArray(cleaned.criteria)) {
      for (const criterion of cleaned.criteria) {
        const normalizer = criterion.normalizer as
          | { type?: string; scores?: unknown }
          | undefined;
        if (normalizer?.type === "enum" && Array.isArray(normalizer.scores)) {
          normalizer.scores = Object.fromEntries(
            (normalizer.scores as Array<{ value?: unknown; score?: unknown }>)
              .filter(
                (entry) =>
                  typeof entry.value === "string" &&
                  typeof entry.score === "number",
              )
              .map((entry) => [entry.value as string, entry.score as number]),
          );
        }
      }
    }

    const hard = cleaned.hard;
    if (hard && Array.isArray(hard.required)) {
      const map: Record<string, unknown> = {};
      for (const entry of hard.required) {
        const pair = entry as { key?: unknown; value?: unknown };
        if (typeof pair.key === "string") map[pair.key] = pair.value;
      }
      hard.required = map;
    }

    for (const criterion of cleaned.criteria ?? []) {
      const hardValue = criterion.hard as
        | { op?: string; min?: unknown; max?: unknown }
        | undefined;
      if (hardValue?.op === "range") {
        if (typeof hardValue.min !== "number") delete hardValue.min;
        if (typeof hardValue.max !== "number") delete hardValue.max;
      }
    }

    if (hard && (typeof hard.rent_max !== "number" || hard.rent_max <= 0)) {
      delete hard.rent_max;
    }
    const bedrooms = hard?.bedrooms as
      | { min?: unknown; max?: unknown }
      | undefined;
    if (
      hard &&
      bedrooms &&
      typeof bedrooms.min !== "number" &&
      typeof bedrooms.max !== "number"
    ) {
      delete hard.bedrooms;
    }

    const anchors = cleaned.anchors;
    if (anchors?.commute && typeof anchors.commute.max_minutes !== "number") {
      delete anchors.commute;
    }
    if (
      anchors?.work &&
      typeof anchors.work.address !== "string" &&
      !(typeof anchors.work.lat === "number" && typeof anchors.work.lon === "number")
    ) {
      delete anchors.work;
    }

    const budgets = cleaned.budgets;
    if (budgets) {
      for (const key of ["max_listings", "max_usd", "max_minutes"]) {
        if (typeof budgets[key] !== "number" || (budgets[key] as number) <= 0) {
          delete budgets[key];
        }
      }
      if (typeof budgets.vision_max !== "number" || budgets.vision_max < 0) {
        delete budgets.vision_max;
      }
      if (typeof budgets.html_max !== "number" || budgets.html_max < 0) {
        delete budgets.html_max;
      }
      if (Object.keys(budgets).length === 0) delete cleaned.budgets;
    }

    return cleaned;
  }
}
