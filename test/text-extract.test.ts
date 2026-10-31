import assert from "node:assert/strict";
import { test } from "node:test";
import type { CriterionSpec } from "../src/domain/types.ts";
import { TextCriteriaExtractor } from "../src/runner/text-extract.ts";
import type { ResponsesClient } from "../src/vision/responses.ts";

function criterion(
  key: string,
  kind: CriterionSpec["kind"],
  overrides: Partial<CriterionSpec> = {},
): CriterionSpec {
  return {
    key,
    label: key.replaceAll("_", " "),
    weight: 1,
    kind,
    normalizer:
      kind === "boolean"
        ? { type: "boolean" }
        : kind === "number"
          ? { type: "lower-is-better", max: 100 }
          : { type: "enum", scores: { house: 1, unit: 0.4 } },
    source: { type: "text", prompt: `Extract ${key}` },
    origin: "explicit",
    ...overrides,
  };
}

function extractorWith(facts: Record<string, { value: unknown; confidence: number }>) {
  const client = {
    async structured() {
      return { data: { facts } };
    },
  } as unknown as ResponsesClient;
  return new TextCriteriaExtractor(client, "test-model");
}

test("boolean text criteria coerce a room-count string instead of failing", async () => {
  const extractor = extractorWith({
    two_rooms: {
      value: "2 bedroom townhouse with 1 bathroom.",
      confidence: 0.9,
    },
    pets: { value: "no", confidence: 0.8 },
  });

  const facts = await extractor.extract({
    description: "2 bedroom townhouse with 1 bathroom. No pets.",
    criteria: [
      criterion("two_rooms", "boolean", {
        label: "At least two rooms",
        source: {
          type: "text",
          prompt:
            "Return true only if there are at least two bedrooms, or one bedroom plus a study.",
        },
      }),
      criterion("pets", "boolean"),
    ],
  });

  assert.equal(facts.find((fact) => fact.key === "two_rooms")?.value, true);
  assert.equal(facts.find((fact) => fact.key === "pets")?.value, false);
});

test("one bedroom plus a study counts as two rooms, but one bedroom alone does not", async () => {
  const plusStudy = extractorWith({
    two_rooms: { value: "1 bedroom plus a separate study", confidence: 1 },
  });
  const oneBed = extractorWith({
    two_rooms: { value: "1 bedroom unit", confidence: 1 },
  });
  const roomCriterion = criterion("two_rooms", "boolean", {
    label: "At least two rooms",
  });

  assert.equal(
    (
      await plusStudy.extract({
        description: "1 bedroom plus a separate study",
        criteria: [roomCriterion],
      })
    )[0]?.value,
    true,
  );
  assert.equal(
    (
      await oneBed.extract({
        description: "1 bedroom unit",
        criteria: [roomCriterion],
      })
    )[0]?.value,
    false,
  );
});

test("enum text criteria canonicalise the model's answer", async () => {
  const extractor = extractorWith({
    property_type: { value: "This is a standalone house.", confidence: 1 },
  });

  const facts = await extractor.extract({
    description: "This is a standalone house.",
    criteria: [
      criterion("property_type", "enum", {
        normalizer: { type: "enum", scores: { house: 1, unit: 0.4 } },
      }),
    ],
  });

  assert.equal(facts[0]?.value, "house");
});
