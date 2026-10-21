import { z } from "zod";
import { applyBriefDelta, cleanSeeds } from "../brief/brief.ts";
import type { Brief, BriefDelta } from "../brief/types.ts";
import { CriterionSchema } from "../brief/criteria.ts";
import {
  applyFeedback,
  type Interpretation,
} from "./interpret.ts";
import type { ResponsesClient } from "../vision/responses.ts";

export interface FeedbackInterpreter {
  interpret(input: { text: string; brief: Brief }): Promise<Interpretation>;
}

const HardSchema = z.object({
  rent_max: z.number().positive().optional(),
  bedrooms: z
    .object({
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().nonnegative().optional(),
    })
    .optional(),
  areas: z.array(z.string()).optional(),
  required: z.record(z.string(), z.unknown()).optional(),
});

const SourcesSchema = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  prefer: z.array(z.string()).optional(),
  web: z.enum(["open", "structured-only", "off"]).optional(),
});

export const BriefDeltaSchema = z.object({
  action: z.enum(["re-score", "re-extract", "re-search"]).optional(),
  setWeights: z.record(z.string(), z.number().min(0).max(1)).optional(),
  addCriteria: z.array(CriterionSchema).optional(),
  removeCriteria: z.array(z.string()).optional(),
  hard: HardSchema.optional(),
  commute: z
    .object({
      mode: z.enum(["drive", "walk", "cycle", "transit"]).optional(),
      maxMinutes: z.number().positive().optional(),
      hard: z.boolean().optional(),
    })
    .optional(),
  addAreas: z.array(z.string()).optional(),
  addAssumptions: z.array(z.string()).optional(),
  removeAssumptions: z.array(z.string()).optional(),
  sources: SourcesSchema.optional(),
  seeds: z.array(z.string()).optional(),
  removeSeeds: z.array(z.string()).optional(),
  queries: z.array(z.string().min(1)).optional(),
  note: z.string().optional(),
});

const SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["re-score", "re-extract", "re-search"],
    },
    setWeights: {
      anyOf: [
        {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              weight: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["key", "weight"],
            additionalProperties: false,
          },
        },
        { type: "null" },
      ],
    },
    addCriteria: {
      anyOf: [
        {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              label: { type: "string" },
              weight: { type: "number", minimum: 0, maximum: 1 },
              kind: { type: "string", enum: ["boolean", "number", "enum"] },
              normalizer: { type: "object" },
              source: { type: "object" },
              origin: { type: "string", enum: ["explicit", "suggested"] },
              hard: { anyOf: [{ type: "object" }, { type: "null" }] },
              unknown: { anyOf: [{ type: "string" }, { type: "null" }] },
              rationale: { anyOf: [{ type: "string" }, { type: "null" }] },
            },
            required: ["key", "label", "weight", "kind", "normalizer", "source"],
            additionalProperties: false,
          },
        },
        { type: "null" },
      ],
    },
    removeCriteria: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
    hard: {
      anyOf: [
        {
          type: "object",
          properties: {
            rent_max: { anyOf: [{ type: "number" }, { type: "null" }] },
            bedrooms: {
              anyOf: [
                {
                  type: "object",
                  properties: {
                    min: { anyOf: [{ type: "number" }, { type: "null" }] },
                    max: { anyOf: [{ type: "number" }, { type: "null" }] },
                  },
                  required: ["min", "max"],
                  additionalProperties: false,
                },
                { type: "null" },
              ],
            },
            areas: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
            required: {
              anyOf: [
                {
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
                },
                { type: "null" },
              ],
            },
          },
          required: ["rent_max", "bedrooms", "areas", "required"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    commute: {
      anyOf: [
        {
          type: "object",
          properties: {
            mode: { anyOf: [{ type: "string" }, { type: "null" }] },
            maxMinutes: { anyOf: [{ type: "number" }, { type: "null" }] },
            hard: { anyOf: [{ type: "boolean" }, { type: "null" }] },
          },
          required: ["mode", "maxMinutes", "hard"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    addAreas: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
    addAssumptions: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
    removeAssumptions: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
    sources: {
      anyOf: [
        {
          type: "object",
          properties: {
            allow: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
            deny: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
            prefer: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
            web: { anyOf: [{ type: "string", enum: ["open", "structured-only", "off"] }, { type: "null" }] },
          },
          required: ["allow", "deny", "prefer", "web"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    seeds: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
    removeSeeds: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
    queries: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
    note: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: [
    "action",
    "setWeights",
    "addCriteria",
    "removeCriteria",
    "hard",
    "commute",
    "addAreas",
    "addAssumptions",
    "removeAssumptions",
    "sources",
    "seeds",
    "removeSeeds",
    "queries",
    "note",
  ],
  additionalProperties: false,
} as const;

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

function buildPrompt(brief: Brief, text: string): string {
  const criteria = brief.criteria
    .map(
      (criterion) =>
        `- ${criterion.key} "${criterion.label}" weight ${criterion.weight} [${criterion.source.type}]`,
    )
    .join("\n");
  return [
    "Turn this feedback on a research campaign into a brief delta.",
    "",
    "Rules:",
    "- Only include fields that the feedback actually changes.",
    "- setWeights uses existing criterion keys.",
    "- addCriteria entries need key, label, weight, kind, normalizer, and source (field/text/image/derived).",
    "- removeCriteria uses existing criterion keys.",
    "- sources takes source ids or bare hosts (for example trademe.co.nz). Use web \"off\" with allow for 'only X'.",
    "- seeds are full http(s) URLs to collect directly.",
    "- queries are extra search phrases.",
    "- action: re-search when areas/sources/seeds/queries change; re-extract when criteria are added; re-score for weights and limits.",
    "- Return an empty object (nulls) when nothing changes.",
    "",
    "Current brief:",
    `prompt: ${brief.prompt}`,
    `hard: ${JSON.stringify(brief.hard)}`,
    `sources: ${JSON.stringify(brief.sources)}`,
    `seeds: ${JSON.stringify(brief.seeds)}`,
    `queries: ${JSON.stringify(brief.queries)}`,
    "criteria:",
    criteria || "(none)",
    "",
    `Feedback: ${text}`,
  ].join("\n");
}

function normaliseDelta(raw: z.infer<typeof BriefDeltaSchema>): BriefDelta {
  const delta: BriefDelta = {
    action: raw.action ?? "re-score",
  };
  if (raw.setWeights) delta.setWeights = raw.setWeights;
  if (raw.addCriteria?.length) {
    delta.addCriteria = raw.addCriteria as BriefDelta["addCriteria"];
  }
  if (raw.removeCriteria?.length) delta.removeCriteria = raw.removeCriteria;
  if (raw.hard) {
    delta.hard = {
      ...(raw.hard.rent_max !== undefined ? { rentMax: raw.hard.rent_max } : {}),
      ...(raw.hard.bedrooms ? { bedrooms: raw.hard.bedrooms } : {}),
      ...(raw.hard.areas ? { areas: raw.hard.areas } : {}),
      ...(raw.hard.required ? { required: raw.hard.required } : {}),
    };
  }
  if (raw.commute) delta.commute = raw.commute;
  if (raw.addAreas?.length) delta.addAreas = raw.addAreas;
  if (raw.addAssumptions?.length) delta.addAssumptions = raw.addAssumptions;
  if (raw.removeAssumptions?.length) delta.removeAssumptions = raw.removeAssumptions;
  if (raw.sources) {
    const sources = Object.fromEntries(
      Object.entries(raw.sources).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(sources).length) {
      delta.sources = sources as BriefDelta["sources"];
    }
  }
  if (raw.seeds?.length) delta.seeds = cleanSeeds(raw.seeds) ?? [];
  if (raw.removeSeeds?.length) delta.removeSeeds = raw.removeSeeds;
  if (raw.queries?.length) delta.queries = raw.queries;
  if (raw.note) delta.note = raw.note;

  if (delta.sources || delta.seeds || delta.removeSeeds || delta.queries) {
    delta.action = "re-search";
  } else if (delta.addCriteria || delta.removeCriteria) {
    delta.action = "re-extract";
  }
  return delta;
}

function describe(delta: BriefDelta): string {
  const parts: string[] = [];
  for (const [key, weight] of Object.entries(delta.setWeights ?? {})) {
    parts.push(`${key} ${weight.toFixed(2)}`);
  }
  for (const key of delta.removeCriteria ?? []) parts.push(`remove ${key}`);
  if (delta.addCriteria?.length) {
    parts.push(`add ${delta.addCriteria.map((criterion) => criterion.key).join(", ")}`);
  }
  if (delta.hard?.rentMax !== undefined) parts.push(`rent <= ${delta.hard.rentMax}`);
  if (delta.hard?.bedrooms) {
    parts.push(
      `bedrooms ${delta.hard.bedrooms.min ?? 0}-${delta.hard.bedrooms.max ?? "∞"}`,
    );
  }
  if (delta.addAreas?.length) parts.push(`areas +${delta.addAreas.join(", ")}`);
  if (delta.sources) {
    if (delta.sources.allow?.length) parts.push(`allow ${delta.sources.allow.join(", ")}`);
    if (delta.sources.deny?.length) parts.push(`deny ${delta.sources.deny.join(", ")}`);
    if (delta.sources.prefer?.length) parts.push(`prefer ${delta.sources.prefer.join(", ")}`);
    if (delta.sources.web) parts.push(`web ${delta.sources.web}`);
  }
  if (delta.seeds?.length) parts.push(`seeds +${delta.seeds.length}`);
  if (delta.removeSeeds?.length) parts.push(`seeds -${delta.removeSeeds.length}`);
  if (delta.queries?.length) parts.push(`queries +${delta.queries.length}`);
  if (delta.commute?.maxMinutes !== undefined) {
    parts.push(`commute <= ${delta.commute.maxMinutes} min`);
  }
  if (parts.length === 0) return "No change understood.";
  return `Understood: ${parts.join(" · ")} [${delta.action}]`;
}

export class ResponsesFeedbackInterpreter implements FeedbackInterpreter {
  constructor(
    private readonly client: ResponsesClient,
    private readonly model: string,
  ) {}

  async interpret(input: { text: string; brief: Brief }): Promise<Interpretation> {
    const result = await this.client.structured<Record<string, unknown>>({
      model: this.model,
      name: "feedback_delta",
      schema: SCHEMA as unknown as Record<string, unknown>,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: buildPrompt(input.brief, input.text) },
          ],
        },
      ],
    });

    const cleaned = stripNulls(result.data);
    const parsed = BriefDeltaSchema.safeParse(cleaned);
    if (!parsed.success) {
      return {
        delta: { action: "re-score" },
        summary: "No change understood.",
        changed: false,
        unparsed: [input.text],
      };
    }
    const delta = normaliseDelta(parsed.data);
    const changed =
      Boolean(delta.setWeights) ||
      Boolean(delta.addCriteria?.length) ||
      Boolean(delta.removeCriteria?.length) ||
      Boolean(delta.hard && Object.keys(delta.hard).length) ||
      Boolean(delta.commute) ||
      Boolean(delta.addAreas?.length) ||
      Boolean(delta.sources) ||
      Boolean(delta.seeds?.length) ||
      Boolean(delta.removeSeeds?.length) ||
      Boolean(delta.queries?.length);
    return {
      delta,
      summary: changed ? describe(delta) : "No change understood.",
      changed,
      unparsed: changed ? [] : [input.text],
    };
  }
}

/** Try the model first; fall back to the deterministic parser. */
export async function applyFeedbackWithInterpreter(
  brief: Brief,
  text: string,
  interpreter?: FeedbackInterpreter,
): Promise<Interpretation & { brief: Brief }> {
  if (interpreter) {
    try {
      const interpretation = await interpreter.interpret({ text, brief });
      if (interpretation.changed) {
        return {
          ...interpretation,
          brief: applyBriefDelta(brief, interpretation.delta),
        };
      }
    } catch {
      // fall through to the regex parser
    }
  }
  return applyFeedback(brief, text);
}
