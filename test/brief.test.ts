import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyBriefDelta,
  briefFromExtraction,
  echoBrief,
  parseBrief,
  serializeBrief,
} from "../src/brief/brief.ts";
import type { BriefExtractor } from "../src/brief/brief.ts";
import { propertyPack } from "../src/domain/property.ts";

const YAML = `
version: 2
domain: property
prompt: "2-3 bed rental in Wellington under $650"
anchors:
  work: { address: "1 Lambton Quay", lat: -41.28, lon: 174.77 }
  commute: { mode: drive, max_minutes: 25, hard: false }
hard:
  rent_max: 650
  bedrooms: { min: 2, max: 3 }
  areas: [Wellington]
soft:
  - { key: parking, weight: 0.9 }
  - { key: sunlight, weight: 0.6 }
unknown_policy: flag
budgets:
  max_listings: 300
  max_usd: 15
  max_minutes: 120
  vision_max: 60
assumptions:
  - "near work means <=25 min drive"
`;

test("parses a brief and round-trips through YAML", () => {
  const brief = parseBrief(YAML);
  assert.equal(brief.version, 2);
  assert.equal(brief.hard.rentMax, 650);
  assert.deepEqual(brief.hard.bedrooms, { min: 2, max: 3 });
  assert.equal(brief.anchors.commute?.maxMinutes, 25);
  assert.equal(brief.budgets.visionMax, 60);

  const again = parseBrief(serializeBrief(brief));
  assert.deepEqual(again, brief);
});

test("invalid briefs fail loudly", () => {
  assert.throws(() => parseBrief("soft: [{ key: parking, weight: 4 }]"));
});

test("compiler merges pack defaults, resolves aliases, and records assumptions", () => {
  const raw = {
    anchors: { commute: { max_minutes: 20, hard: true } },
    hard: { rent_max: 650, bedrooms: { min: 2, max: 3 } },
    soft: [
      { key: "carpark", weight: 0.95 },
      { key: "nonsense", weight: 0.5 },
    ],
  };
  const brief = briefFromExtraction("find a rental", propertyPack, raw);

  const weights = Object.fromEntries(
    brief.soft.map((criterion) => [criterion.key, criterion.weight]),
  );
  assert.equal(weights.parking, 0.95);
  assert.equal(weights.commute, 0.8);
  assert.equal(weights.sunlight, 0.6);
  assert.equal(weights.nonsense, undefined);
  assert.equal(brief.domain, "property");
  assert.ok(brief.assumptions.some((a) => a.includes("<=20 min drive")));
  assert.ok(brief.assumptions.some((a) => a.includes("sunlight is inferred")));
});

test("compileBrief uses the injected extractor", async () => {
  const extractor: BriefExtractor = {
    async extract() {
      return { hard: { rent_max: 500 } };
    },
  };
  const { compileBrief } = await import("../src/brief/brief.ts");
  const brief = await compileBrief("cheap rental", propertyPack, extractor);
  assert.equal(brief.hard.rentMax, 500);
  assert.equal(brief.soft.length, propertyPack.defaultCriteria.length - 1);
  assert.equal(
    brief.soft.some((criterion) => criterion.key === "commute"),
    false,
  );
});

test("echoBrief states hard limits, weights, commute, and assumptions", () => {
  const brief = briefFromExtraction("find a rental", propertyPack, {
    anchors: { commute: { max_minutes: 20, hard: true } },
    hard: { rent_max: 650, bedrooms: { min: 2, max: 3 } },
    soft: [{ key: "carpark", weight: 0.95 }],
  });
  const echo = echoBrief(brief);
  assert.match(echo, /Hard: rent <= 650 · beds 2-3/);
  assert.match(echo, /parking 0\.95/);
  assert.match(echo, /Commute: drive <= 20 min \(hard\)/);
  assert.match(echo, /Assumed: "near work" means <=20 min drive/);
});

test("applyBriefDelta re-weights, widens areas, and bumps the version", () => {
  const brief = parseBrief(YAML);
  const next = applyBriefDelta(brief, {
    action: "re-score",
    setWeights: { sunlight: 0, parking: 1 },
    commute: { maxMinutes: 15, hard: true },
    addAreas: ["Petone"],
    addAssumptions: ["sunlight no longer matters"],
    removeAssumptions: ["near work means <=25 min drive"],
  });

  assert.equal(next.version, brief.version + 1);
  assert.deepEqual(
    Object.fromEntries(next.soft.map((c) => [c.key, c.weight])),
    { parking: 1, sunlight: 0 },
  );
  assert.equal(next.anchors.commute?.maxMinutes, 15);
  assert.equal(next.anchors.commute?.hard, true);
  assert.deepEqual(next.hard.areas, ["Wellington", "Petone"]);
  assert.ok(next.assumptions.includes("sunlight no longer matters"));
  assert.ok(!next.assumptions.includes("near work means <=25 min drive"));

  assert.equal(brief.anchors.commute?.maxMinutes, 25);
  assert.equal(brief.soft.find((c) => c.key === "sunlight")?.weight, 0.6);
});
