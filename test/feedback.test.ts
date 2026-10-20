import assert from "node:assert/strict";
import { test } from "node:test";
import { briefFromExtraction } from "../src/brief/brief.ts";
import { propertyPack } from "../src/domain/property.ts";
import {
  applyFeedback,
  interpretFeedback,
} from "../src/feedback/interpret.ts";

function baseBrief() {
  return briefFromExtraction("find a rental", propertyPack, {
    anchors: { commute: { max_minutes: 25, hard: false } },
    hard: { rent_max: 700 },
    soft: [
      { key: "carpark", weight: 0.7 },
      { key: "sunlight", weight: 0.6 },
    ],
  });
}

test("re-score: weights move in both directions", () => {
  const brief = baseBrief();
  const result = applyFeedback(
    brief,
    "I don't care about sunlight, I really want a carpark",
    propertyPack,
  );

  assert.equal(result.delta.action, "re-score");
  assert.equal(result.brief.soft.find((c) => c.key === "sunlight")?.weight, 0);
  assert.equal(result.brief.soft.find((c) => c.key === "parking")?.weight, 1);
  assert.match(result.summary, /Sunlight 0\.00/);
  assert.match(result.summary, /Parking 1\.00/);
  assert.equal(result.brief.version, brief.version + 1);
});

test("re-score: commute tightened and made hard", () => {
  const result = applyFeedback(
    baseBrief(),
    "the commute is too far, cut it to 15 min",
    propertyPack,
  );
  assert.equal(result.brief.anchors.commute?.maxMinutes, 15);
  assert.equal(result.brief.anchors.commute?.hard, true);
  assert.match(result.summary, /commute <= 15 min \(hard\)/);
});

test("re-score: rent and bedroom limits", () => {
  const rent = applyFeedback(
    baseBrief(),
    "keep it under $600 a week",
    propertyPack,
  );
  assert.equal(rent.brief.hard.rentMax, 600);

  const beds = applyFeedback(baseBrief(), "2-3 bedrooms only", propertyPack);
  assert.deepEqual(beds.brief.hard.bedrooms, { min: 2, max: 3 });
});

test("re-search: adding an area", () => {
  const result = applyFeedback(baseBrief(), "also look at Petone", propertyPack);
  assert.equal(result.delta.action, "re-search");
  assert.deepEqual(result.delta.addAreas, ["Petone"]);
  assert.ok(result.brief.hard.areas?.includes("Petone"));
  assert.match(result.summary, /areas \+Petone/);
});

test("re-search: a missed property type becomes a requirement", () => {
  const result = applyFeedback(
    baseBrief(),
    "you missed townhouses",
    propertyPack,
  );
  assert.equal(result.delta.action, "re-search");
  assert.equal(result.brief.hard.required?.property_type, "townhouse");
});

test("re-extract: a new photo feature", () => {
  const result = applyFeedback(
    baseBrief(),
    "check the photos for mould",
    propertyPack,
  );
  assert.equal(result.delta.action, "re-extract");
  assert.deepEqual(result.delta.features, ["damp_signs"]);
  assert.match(result.summary, /re-extract damp signs/);
});

test("required attributes map to canonical keys", () => {
  const heat = applyFeedback(
    baseBrief(),
    "must have a heat pump",
    propertyPack,
  );
  assert.equal(heat.brief.hard.required?.heat_pump, true);

  const carpet = applyFeedback(baseBrief(), "no carpet", propertyPack);
  assert.equal(carpet.brief.hard.required?.carpet, false);
});

test("unrecognised feedback changes nothing and does not bump the version", () => {
  const brief = baseBrief();
  const result = applyFeedback(brief, "hmm, not sure", propertyPack);
  assert.equal(result.changed, false);
  assert.equal(result.brief, brief);
  assert.equal(result.summary, "No change understood.");
  assert.deepEqual(result.unparsed, ["hmm, not sure"]);
});

test("interpretFeedback is pure", () => {
  const brief = baseBrief();
  const before = JSON.stringify(brief);
  interpretFeedback("also look at Petone", brief, propertyPack);
  assert.equal(JSON.stringify(brief), before);
});
