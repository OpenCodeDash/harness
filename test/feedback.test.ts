import assert from "node:assert/strict";
import { test } from "node:test";
import { briefFromExtraction } from "../src/brief/brief.ts";
import {
  applyFeedback,
  interpretFeedback,
} from "../src/feedback/interpret.ts";
import {
  applyFeedbackWithInterpreter,
  ResponsesFeedbackInterpreter,
  type FeedbackInterpreter,
} from "../src/feedback/model.ts";
import type { ResponsesClient } from "../src/vision/responses.ts";

function baseBrief() {
  return briefFromExtraction("find a rental", {
    anchors: { commute: { max_minutes: 25, hard: false } },
    hard: { rent_max: 700 },
    criteria: [
      {
        key: "parking",
        label: "Parking",
        weight: 0.7,
        kind: "boolean",
        normalizer: { type: "boolean" },
        source: { type: "field", field: "parking" },
        origin: "explicit",
      },
      {
        key: "sunlight",
        label: "Sunlight",
        weight: 0.6,
        kind: "boolean",
        normalizer: { type: "boolean" },
        source: { type: "text", prompt: "Is the listing described as sunny?" },
        origin: "explicit",
      },
    ],
  });
}

test("re-score: weights move in both directions", () => {
  const brief = baseBrief();
  const result = applyFeedback(
    brief,
    "I don't care about sunlight, I really want parking",
  );

  assert.equal(result.delta.action, "re-score");
  assert.equal(result.brief.criteria.find((c) => c.key === "sunlight")?.weight, 0);
  assert.equal(result.brief.criteria.find((c) => c.key === "parking")?.weight, 1);
  assert.match(result.summary, /Sunlight 0\.00/);
  assert.match(result.summary, /Parking 1\.00/);
  assert.equal(result.brief.version, brief.version + 1);
});

test("re-score: commute tightened and made hard", () => {
  const result = applyFeedback(
    baseBrief(),
    "the commute is too far, cut it to 15 min",
  );
  assert.equal(result.brief.anchors.commute?.maxMinutes, 15);
  assert.equal(result.brief.anchors.commute?.hard, true);
  assert.match(result.summary, /commute <= 15 min \(hard\)/);
});

test("re-score: rent and bedroom limits", () => {
  const rent = applyFeedback(baseBrief(), "keep it under $600 a week");
  assert.equal(rent.brief.hard.rentMax, 600);

  const beds = applyFeedback(baseBrief(), "2-3 bedrooms only");
  assert.deepEqual(beds.brief.hard.bedrooms, { min: 2, max: 3 });
});

test("re-search: adding an area", () => {
  const result = applyFeedback(baseBrief(), "also look at Petone");
  assert.equal(result.delta.action, "re-search");
  assert.deepEqual(result.delta.addAreas, ["Petone"]);
  assert.ok(result.brief.hard.areas?.includes("Petone"));
  assert.match(result.summary, /areas \+Petone/);
});

test("required attributes map to canonical keys", () => {
  const brand = applyFeedback(baseBrief(), "must have a brand");
  assert.equal(brand.brief.hard.required?.brand, true);

  const noBrand = applyFeedback(baseBrief(), "no brand");
  assert.equal(noBrand.brief.hard.required?.brand, false);
});

test("unrecognised feedback changes nothing and does not bump the version", () => {
  const brief = baseBrief();
  const result = applyFeedback(brief, "hmm, not sure");
  assert.equal(result.changed, false);
  assert.equal(result.brief, brief);
  assert.equal(result.summary, "No change understood.");
  assert.deepEqual(result.unparsed, ["hmm, not sure"]);
});

test("interpretFeedback is pure", () => {
  const brief = baseBrief();
  const before = JSON.stringify(brief);
  interpretFeedback("also look at Petone", brief);
  assert.equal(JSON.stringify(brief), before);
});

test("the model interpreter turns feedback into a source/seed delta", async () => {
  const client = {
    async structured() {
      return {
        data: {
          action: "re-score",
          setWeights: null,
          addCriteria: null,
          removeCriteria: null,
          hard: null,
          commute: null,
          addAreas: null,
          addAssumptions: null,
          removeAssumptions: null,
          sources: { allow: ["trademe.co.nz"], web: "off" },
          seeds: ["https://www.trademe.co.nz/a/marketplace/listing/1"],
          removeSeeds: null,
          queries: ["m2 macbook auckland"],
          note: null,
        },
      };
    },
  } as unknown as ResponsesClient;

  const interpreter = new ResponsesFeedbackInterpreter(client, "model");
  const applied = await applyFeedbackWithInterpreter(
    baseBrief(),
    "only trademe.co.nz, start from that listing",
    interpreter,
  );

  assert.equal(applied.changed, true);
  assert.equal(applied.delta.action, "re-search");
  assert.deepEqual(applied.brief.sources.allow, ["trademe.co.nz"]);
  assert.equal(applied.brief.sources.web, "off");
  assert.deepEqual(applied.brief.seeds, [
    "https://www.trademe.co.nz/a/marketplace/listing/1",
  ]);
  assert.deepEqual(applied.brief.queries, ["m2 macbook auckland"]);
  assert.match(applied.summary, /allow trademe\.co\.nz/);
});

test("the interpreter falls back to the regex parser when the model fails", async () => {
  const broken: FeedbackInterpreter = {
    async interpret() {
      throw new Error("model down");
    },
  };
  const applied = await applyFeedbackWithInterpreter(
    baseBrief(),
    "2-3 bedrooms only",
    broken,
  );
  assert.deepEqual(applied.brief.hard.bedrooms, { min: 2, max: 3 });
});

test("the interpreter falls back when the model understands nothing", async () => {
  const empty: FeedbackInterpreter = {
    async interpret() {
      return {
        delta: { action: "re-score" },
        summary: "No change understood.",
        changed: false,
        unparsed: ["x"],
      };
    },
  };
  const applied = await applyFeedbackWithInterpreter(
    baseBrief(),
    "also look at Petone",
    empty,
  );
  assert.equal(applied.delta.action, "re-search");
  assert.deepEqual(applied.delta.addAreas, ["Petone"]);
});
