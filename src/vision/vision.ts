import { readFile } from "node:fs/promises";
import type { ImageFeatureDef } from "../domain/types.ts";
import { hashBuffer } from "./media.ts";
import type { ResponsesClient } from "./responses.ts";

export interface ImageFact {
  key: string;
  value: unknown;
  confidence: number;
  sourceRef: string;
}

export interface ImageExtraction {
  facts: ImageFact[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

const PROBE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC";

function valueSchema(feature: ImageFeatureDef): Record<string, unknown> {
  if (feature.kind === "boolean") {
    return { anyOf: [{ type: "boolean" }, { type: "null" }] };
  }
  if (feature.kind === "number") {
    return { anyOf: [{ type: "number" }, { type: "null" }] };
  }
  if (feature.options?.length) {
    return {
      anyOf: [{ type: "string", enum: feature.options }, { type: "null" }],
    };
  }
  return { anyOf: [{ type: "string" }, { type: "null" }] };
}

export function buildVisionSchema(
  features: ImageFeatureDef[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const feature of features) {
    properties[feature.key] = {
      type: "object",
      properties: {
        value: valueSchema(feature),
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["value", "confidence"],
      additionalProperties: false,
    };
  }
  return {
    type: "object",
    properties: {
      features: {
        type: "object",
        properties,
        required: features.map((feature) => feature.key),
        additionalProperties: false,
      },
    },
    required: ["features"],
    additionalProperties: false,
  };
}

export function buildVisionPrompt(features: ImageFeatureDef[]): string {
  const lines = features.map((feature) => {
    const kind =
      feature.kind === "enum"
        ? `one of ${feature.options?.join(", ") ?? "any string"}`
        : feature.kind;
    return `- ${feature.key} (${kind}): ${feature.prompt}`;
  });
  return [
    "Inspect this listing photo and report only what is visible.",
    "For each feature, return a value and a confidence from 0 to 1.",
    "If a feature is not visible or you cannot tell, return null. Never guess.",
    "Features:",
    ...lines,
    'Return JSON: {"features":{"<key>":{"value":<value>,"confidence":<0..1>}}}',
  ].join("\n");
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export async function extractFactsFromBuffer(
  client: ResponsesClient,
  input: {
    buffer: Uint8Array;
    mimeType?: string;
    features: ImageFeatureDef[];
    model: string;
  },
): Promise<ImageExtraction> {
  const hash = `sha256:${hashBuffer(input.buffer)}`;
  const mimeType = input.mimeType ?? "image/jpeg";
  const result = await client.structured<{
    features?: Record<string, { value?: unknown; confidence?: number }>;
  }>({
    model: input.model,
    name: "image_features",
    schema: buildVisionSchema(input.features),
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: buildVisionPrompt(input.features) },
          {
            type: "input_image",
            image_url: `data:${mimeType};base64,${Buffer.from(input.buffer).toString("base64")}`,
          },
        ],
      },
    ],
  });

  const facts: ImageFact[] = [];
  for (const feature of input.features) {
    const entry = result.data.features?.[feature.key];
    if (!entry || entry.value === null || entry.value === undefined) continue;
    const confidence =
      typeof entry.confidence === "number" ? clamp01(entry.confidence) : 0.5;
    facts.push({
      key: feature.key,
      value: entry.value,
      confidence,
      sourceRef: hash,
    });
  }
  return { facts, usage: result.usage };
}

export async function extractImageFacts(
  client: ResponsesClient,
  input: {
    imagePath: string;
    mimeType?: string;
    features: ImageFeatureDef[];
    model: string;
  },
): Promise<ImageExtraction> {
  const buffer = await readFile(input.imagePath);
  return extractFactsFromBuffer(client, { ...input, buffer });
}

export async function probeVision(
  client: ResponsesClient,
  model: string,
): Promise<void> {
  const result = await client.structured<{ ok?: boolean }>({
    model,
    name: "vision_probe",
    maxOutputTokens: 32,
    schema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    },
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: 'Reply with {"ok":true} if you can see this image.',
          },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${PROBE_PNG_BASE64}`,
          },
        ],
      },
    ],
  });
  if (result.data.ok !== true) {
    throw new Error("vision probe returned ok=false");
  }
}
