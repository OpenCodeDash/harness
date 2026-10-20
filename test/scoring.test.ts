import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BUDGETS, type Brief } from "../src/brief/types.ts";
import { propertyPack } from "../src/domain/property.ts";
import {
  isTie,
  normalizeValue,
  scoreListing,
  selectFacts,
  type Fact,
  type Facts,
} from "../src/scoring/score.ts";

function makeBrief(partial: Partial<Brief> = {}): Brief {
  return {
    version: 1,
    domain: "property",
    prompt: "test",
    anchors: {},
    hard: {},
    soft: [],
    unknownPolicy: "flag",
    budgets: DEFAULT_BUDGETS,
    assumptions: [],
    ...partial,
  };
}

function fact(
  key: string,
  value: unknown,
  overrides: Partial<Fact> = {},
): Fact {
  return {
    key,
    value,
    sourceType: "page",
    sourceRef: "test",
    confidence: 1,
    observedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function facts(...items: Fact[]): Facts {
  return selectFacts(items);
}

test("normalizers clamp and reject unrecognised values", () => {
  assert.equal(normalizeValue({ type: "boolean" }, true), 1);
  assert.equal(normalizeValue({ type: "boolean" }, "yes"), 1);
  assert.equal(normalizeValue({ type: "boolean" }, "no"), 0);
  assert.equal(normalizeValue({ type: "boolean" }, "maybe"), null);

  assert.equal(normalizeValue({ type: "lower-is-better", max: 45 }, 0), 1);
  assert.equal(normalizeValue({ type: "lower-is-better", max: 45 }, 45), 0);
  assert.equal(normalizeValue({ type: "lower-is-better", max: 45 }, 22.5), 0.5);

  assert.equal(normalizeValue({ type: "range", min: 2, max: 3 }, 2), 1);
  assert.equal(normalizeValue({ type: "range", min: 2, max: 3 }, 3), 1);
  assert.equal(normalizeValue({ type: "range", min: 2, max: 3 }, 1), 0.5);
  assert.equal(normalizeValue({ type: "range", min: 2, max: 3 }, 5), 0);

  assert.equal(normalizeValue({ type: "enum", scores: { high: 1 } }, "HIGH"), 1);
  assert.equal(normalizeValue({ type: "enum", scores: { high: 1 } }, "low"), null);
});

test("scores fully-known listings", () => {
  const brief = makeBrief({
    hard: { rentMax: 650, bedrooms: { min: 2, max: 3 } },
    soft: [
      { key: "parking", weight: 0.5 },
      { key: "sunlight", weight: 0.5 },
    ],
  });
  const result = scoreListing(
    brief,
    propertyPack,
    facts(
      fact("rent", 600),
      fact("bedrooms", 2),
      fact("parking", true),
      fact("sunlight", "high"),
    ),
  );

  assert.equal(result.hardPass, true);
  assert.equal(result.score, 1);
  assert.equal(result.coverage, 1);
  assert.deepEqual(result.gaps, []);
});

test("unknown is flagged by default and excluded from the score mass", () => {
  const brief = makeBrief({
    soft: [
      { key: "parking", weight: 0.5 },
      { key: "sunlight", weight: 0.5 },
    ],
  });
  const result = scoreListing(
    brief,
    propertyPack,
    facts(fact("sunlight", "high")),
  );

  assert.equal(result.score, 1);
  assert.equal(result.coverage, 0.5);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0]?.key, "parking");
  assert.equal(result.gaps[0]?.reason, "missing");
});

test("unknown can be penalised instead of flagged", () => {
  const brief = makeBrief({
    unknownPolicy: "penalize",
    soft: [
      { key: "parking", weight: 0.5 },
      { key: "sunlight", weight: 0.5 },
    ],
  });
  const result = scoreListing(
    brief,
    propertyPack,
    facts(fact("sunlight", "high")),
  );

  assert.equal(result.score, 0.5);
  assert.equal(result.coverage, 0.5);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.breakdown.find((b) => b.key === "parking")?.penalized, true);
});

test("low-confidence facts are treated as unknown", () => {
  const brief = makeBrief({ soft: [{ key: "parking", weight: 1 }] });
  const result = scoreListing(
    brief,
    propertyPack,
    facts(fact("parking", true, { confidence: 0.2 })),
  );

  assert.equal(result.score, 0);
  assert.equal(result.coverage, 0);
  assert.match(result.gaps[0]?.reason ?? "", /low confidence/);
});

test("hard constraints fail loudly with reasons", () => {
  const brief = makeBrief({
    hard: {
      rentMax: 650,
      bedrooms: { min: 2, max: 3 },
      areas: ["Wellington"],
      required: { parking: true },
    },
    anchors: { commute: { mode: "drive", maxMinutes: 25, hard: true } },
  });
  const result = scoreListing(
    brief,
    propertyPack,
    facts(
      fact("rent", 700),
      fact("bedrooms", 4),
      fact("suburb", "Auckland Central"),
      fact("parking", false),
      fact("commute", 30),
    ),
  );

  assert.equal(result.hardPass, false);
  assert.ok(result.hardFailures.some((f) => f.includes("rent 700")));
  assert.ok(result.hardFailures.some((f) => f.includes("bedrooms 4")));
  assert.ok(result.hardFailures.some((f) => f.includes("outside areas")));
  assert.ok(result.hardFailures.some((f) => f.includes("parking !=")));
  assert.ok(result.hardFailures.some((f) => f.includes("commute 30 min")));
});

test("missing hard facts are failures, not passes", () => {
  const result = scoreListing(
    makeBrief({ hard: { rentMax: 650, bedrooms: { min: 2 } } }),
    propertyPack,
    facts(),
  );
  assert.equal(result.hardPass, false);
  assert.deepEqual(result.hardFailures, ["rent unknown", "bedrooms unknown"]);
});

test("user evidence outranks extracted evidence even when older", () => {
  const factsMap = facts(
    fact("parking", true, {
      sourceType: "user",
      observedAt: "2026-09-01T00:00:00.000Z",
      confidence: 1,
    }),
    fact("parking", false, {
      sourceType: "page",
      observedAt: "2026-10-01T00:00:00.000Z",
      confidence: 1,
    }),
  );
  assert.equal(factsMap.get("parking")?.value, true);
});

test("zero-weight criteria are ignored and unknown keys are noted", () => {
  const brief = makeBrief({
    soft: [
      { key: "parking", weight: 0 },
      { key: "mystery", weight: 1 },
      { key: "sunlight", weight: 1 },
    ],
  });
  const result = scoreListing(brief, propertyPack, facts(fact("sunlight", "high")));

  assert.equal(result.score, 1);
  assert.equal(result.coverage, 1);
  assert.equal(
    result.breakdown.find((b) => b.key === "parking")?.policy,
    "ignored",
  );
  assert.ok(result.notes.some((note) => note.includes("mystery")));
});

test("tie bands are explicit", () => {
  assert.equal(isTie(0.8, 0.82), true);
  assert.equal(isTie(0.8, 0.84), false);
});
