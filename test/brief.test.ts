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
criteria:
  - key: parking
    label: Parking
    weight: 0.9
    kind: boolean
    normalizer: { type: boolean }
    source: { type: field, field: parking }
    origin: explicit
  - key: sunlight
    label: Sunlight
    weight: 0.6
    kind: enum
    normalizer:
      type: enum
      scores: { none: 0, low: 0.33, moderate: 0.66, high: 1 }
    source:
      type: image
      prompt: "Judge direct sunlight visible in the photo."
      options: [none, low, moderate, high]
    origin: suggested
    rationale: "Wellington rentals can be dark"
unknown_policy: flag
budgets:
  max_listings: 300
  max_usd: 15
  max_minutes: 120
  vision_max: 60
assumptions:
  - "near work means <=25 min drive"
`;

test("parses a criteria brief and round-trips through YAML", () => {
  const brief = parseBrief(YAML);
  assert.equal(brief.version, 2);
  assert.equal(brief.hard.rentMax, 650);
  assert.deepEqual(brief.hard.bedrooms, { min: 2, max: 3 });
  assert.equal(brief.anchors.commute?.maxMinutes, 25);
  assert.equal(brief.budgets.visionMax, 60);
  assert.equal(brief.criteria.length, 2);
  assert.equal(brief.criteria[0]?.key, "parking");
  assert.equal(brief.criteria[1]?.origin, "suggested");

  const again = parseBrief(serializeBrief(brief));
  assert.deepEqual(again, brief);
});

test("invalid briefs fail loudly", () => {
  assert.throws(() => parseBrief("criteria: [{ key: x, weight: 4 }]"));
});

test("compiler uses only the criteria it is given, not pack defaults", () => {
  const brief = briefFromExtraction("find a rental", propertyPack, {
    hard: { rent_max: 650, bedrooms: { min: 2, max: 3 } },
    criteria: [
      {
        key: "parking",
        label: "Parking",
        weight: 0.95,
        kind: "boolean",
        normalizer: { type: "boolean" },
        source: { type: "field", field: "carpark" },
        origin: "explicit",
      },
      {
        key: "damp",
        label: "Damp",
        weight: 0.4,
        kind: "boolean",
        normalizer: { type: "boolean", prefer: false },
        source: { type: "image", prompt: "Any visible damp or mould?" },
        origin: "suggested",
        rationale: "common in older rentals",
      },
      {
        key: "bogus",
        label: "Bogus",
        weight: 0.5,
        kind: "boolean",
        normalizer: { type: "boolean" },
        source: { type: "field", field: "nope" },
        origin: "suggested",
      },
    ],
  });

  assert.deepEqual(
    brief.criteria.map((criterion) => criterion.key),
    ["parking", "damp"],
  );
  assert.equal(brief.criteria[0]?.source.type, "field");
  assert.equal(
    brief.criteria[0]?.source.type === "field"
      ? brief.criteria[0].source.field
      : null,
    "parking",
  );
  assert.equal(brief.criteria[1]?.origin, "suggested");
  assert.equal(
    brief.criteria[1]?.normalizer.type === "boolean"
      ? brief.criteria[1].normalizer.prefer
      : null,
    false,
  );
  assert.ok(brief.warnings.some((warning) => warning.includes("nope")));
  assert.ok(!brief.criteria.some((criterion) => criterion.key === "sunlight"));
  assert.ok(brief.assumptions.some((a) => a.includes("image criteria")));
});

test("sparse extraction falls back to pack suggestions", () => {
  const brief = briefFromExtraction("find a rental", propertyPack, {});
  assert.ok(brief.criteria.length > 0);
  assert.ok(brief.criteria.every((criterion) => criterion.origin === "suggested"));
  assert.ok(
    !brief.criteria.some(
      (criterion) =>
        criterion.source.type === "derived" &&
        criterion.source.evaluator === "commute",
    ),
  );
  assert.ok(brief.warnings.some((warning) => warning.includes("fallback")));
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
  assert.equal(brief.criteria.length, propertyPack.defaultCriteria.length - 1);
  assert.equal(
    brief.criteria.some(
      (criterion) =>
        criterion.source.type === "derived" &&
        criterion.source.evaluator === "commute",
    ),
    false,
  );
});

test("echoBrief states hard limits, criteria, commute, and assumptions", () => {
  const brief = briefFromExtraction("find a rental", propertyPack, {
    anchors: { commute: { max_minutes: 20, hard: true } },
    hard: { rent_max: 650, bedrooms: { min: 2, max: 3 } },
    criteria: [
      {
        key: "parking",
        label: "Parking",
        weight: 0.95,
        kind: "boolean",
        normalizer: { type: "boolean" },
        source: { type: "field", field: "parking" },
        origin: "explicit",
        hard: { op: "eq", value: true },
      },
    ],
  });
  const echo = echoBrief(brief);
  assert.match(echo, /Hard: rent <= 650 · beds 2-3/);
  assert.match(echo, /Parking 0\.95 \[field:parking\] · hard true/);
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
    Object.fromEntries(next.criteria.map((c) => [c.key, c.weight])),
    { parking: 1, sunlight: 0 },
  );
  assert.equal(next.anchors.commute?.maxMinutes, 15);
  assert.equal(next.anchors.commute?.hard, true);
  assert.deepEqual(next.hard.areas, ["Wellington", "Petone"]);
  assert.ok(next.assumptions.includes("sunlight no longer matters"));
  assert.ok(!next.assumptions.includes("near work means <=25 min drive"));

  assert.equal(brief.anchors.commute?.maxMinutes, 25);
  assert.equal(
    brief.criteria.find((c) => c.key === "sunlight")?.weight,
    0.6,
  );
});

test("applyBriefDelta can add and remove dynamic criteria", () => {
  const brief = parseBrief(YAML);
  const next = applyBriefDelta(
    brief,
    {
      action: "re-extract",
      addCriteria: [
        {
          key: "mould",
          label: "Mould",
          weight: 0.5,
          kind: "boolean",
          normalizer: { type: "boolean", prefer: false },
          source: { type: "image", prompt: "Any visible mould?" },
          origin: "explicit",
        },
      ],
      removeCriteria: ["sunlight"],
    },
    propertyPack,
  );

  assert.ok(next.criteria.some((criterion) => criterion.key === "mould"));
  assert.ok(!next.criteria.some((criterion) => criterion.key === "sunlight"));
});

test("legacy soft briefs migrate to full criteria", () => {
  const brief = parseBrief(
    `
hard: { rent_max: 650 }
soft:
  - { key: parking, weight: 0.8 }
  - { key: carpark, weight: 0.9 }
`,
    propertyPack,
  );
  assert.equal(brief.criteria.length, 1);
  assert.equal(brief.criteria[0]?.key, "parking");
  assert.equal(brief.criteria[0]?.weight, 0.9);
  assert.equal(brief.criteria[0]?.origin, "explicit");
  assert.equal(brief.criteria[0]?.source.type, "field");
});

test("parses and round-trips the source scope", () => {
  const brief = parseBrief(`
sources:
  allow: [TradeMe, trademe]
  deny: [Facebook.com]
  prefer: [trademe]
  web: structured-only
`);
  assert.deepEqual(brief.sources, {
    allow: ["trademe"],
    deny: ["facebook.com"],
    prefer: ["trademe"],
    web: "structured-only",
  });
  assert.deepEqual(parseBrief(serializeBrief(brief)), brief);
});

test("source scope defaults to open web and is echoed", () => {
  const open = briefFromExtraction("find a rental", propertyPack, {});
  assert.deepEqual(open.sources, { web: "open" });
  assert.ok(
    open.assumptions.includes(
      "searching the open web; no source restrictions",
    ),
  );
  assert.match(echoBrief(open), /Sources: web open/);

  const restricted = briefFromExtraction("find a rental", propertyPack, {
    sources: { allow: ["trademe"], web: "off" },
  });
  assert.deepEqual(restricted.sources, { allow: ["trademe"], web: "off" });
  assert.ok(
    restricted.assumptions.includes(
      "open-web discovery off; allowed sources only",
    ),
  );
  assert.match(echoBrief(restricted), /Sources: web off · allow: trademe/);
});

test("pack field validation includes the generic vocabulary", () => {
  const brief = briefFromExtraction("anything under 1000", propertyPack, {
    criteria: [
      {
        key: "price",
        label: "Price",
        weight: 0.5,
        kind: "number",
        normalizer: { type: "lower-is-better", max: 1000 },
        source: { type: "field", field: "price" },
        origin: "explicit",
      },
    ],
  });
  assert.equal(brief.criteria[0]?.source.type, "field");
  assert.equal(
    brief.criteria[0]?.source.type === "field"
      ? brief.criteria[0].source.field
      : null,
    "price",
  );
});

test("an unknown pack compiles with the generic vocabulary", async () => {
  const { getPack } = await import("../src/domain/index.ts");
  const generic = getPack("spaceships");
  assert.equal(generic.id, "generic");
  const brief = briefFromExtraction("find something", generic, {});
  assert.equal(brief.domain, "generic");
  assert.ok(brief.criteria.some((criterion) => criterion.key === "price"));
});
