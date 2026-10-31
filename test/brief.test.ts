import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyBriefDelta,
  briefFromExtraction,
  detectOnlySite,
  echoBrief,
  extractSeedUrls,
  parseBrief,
  serializeBrief,
} from "../src/brief/brief.ts";
import type { BriefExtractor } from "../src/brief/brief.ts";

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

test("compiler uses only the criteria it is given", () => {
  const brief = briefFromExtraction("find a rental", {
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
    ["parking", "bogus", "damp"],
  );
  assert.equal(brief.criteria[0]?.source.type, "field");
  assert.equal(
    brief.criteria[0]?.source.type === "field"
      ? brief.criteria[0].source.field
      : null,
    "parking",
  );
  const damp = brief.criteria.find((criterion) => criterion.key === "damp");
  assert.equal(damp?.origin, "suggested");
  assert.equal(
    damp?.normalizer.type === "boolean" ? damp.normalizer.prefer : null,
    false,
  );
  assert.ok(!brief.criteria.some((criterion) => criterion.key === "sunlight"));
  assert.ok(brief.assumptions.some((a) => a.includes("image criteria")));
});

test("sparse extraction falls back to core suggestions", () => {
  const brief = briefFromExtraction("find a rental", {});
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
  const brief = await compileBrief("cheap rental", extractor);
  assert.equal(brief.hard.rentMax, 500);
  assert.equal(brief.criteria.length, 2);
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
  const brief = briefFromExtraction("find a rental", {
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
  );

  assert.ok(next.criteria.some((criterion) => criterion.key === "mould"));
  assert.ok(!next.criteria.some((criterion) => criterion.key === "sunlight"));
});

test("legacy soft briefs migrate to full criteria", () => {
  const brief = parseBrief(
    `
hard: { rent_max: 650 }
soft:
  - { key: price, weight: 0.8 }
  - { key: cost, weight: 0.9 }
`,
  );
  assert.equal(brief.criteria.length, 1);
  assert.equal(brief.criteria[0]?.key, "price");
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
  const open = briefFromExtraction("find a rental", {});
  assert.deepEqual(open.sources, { web: "open" });
  assert.ok(
    open.assumptions.includes(
      "searching the open web; no source restrictions",
    ),
  );
  assert.match(echoBrief(open), /Sources: web open/);

  const restricted = briefFromExtraction("find a rental", {
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

test("field validation includes the core vocabulary", () => {
  const brief = briefFromExtraction("anything under 1000", {
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

test("a prompt compiles with the core vocabulary and no preset", () => {
  const brief = briefFromExtraction("find something", {});
  assert.equal(brief.domain, "generic");
  assert.ok(brief.criteria.some((criterion) => criterion.key === "price"));
});

test("seed URLs and only-site phrases are extracted from the prompt", () => {
  const prompt =
    "only from trademe.co.nz: https://www.trademe.co.nz/a/marketplace/listing/1 and https://example.com/x.";
  assert.deepEqual(extractSeedUrls(prompt), [
    "https://www.trademe.co.nz/a/marketplace/listing/1",
    "https://example.com/x",
  ]);
  assert.equal(detectOnlySite(prompt), "trademe.co.nz");
  assert.equal(detectOnlySite("trademe.co.nz only"), "trademe.co.nz");
  assert.equal(detectOnlySite("find a macbook"), null);
});

test("compiling an only-site prompt creates an allow-list and seeds", () => {
  const brief = briefFromExtraction(
    "only from trademe.co.nz: https://www.trademe.co.nz/a/listing/1",
    {},
  );
  assert.deepEqual(brief.sources.allow, ["trademe.co.nz"]);
  assert.equal(brief.sources.web, "off");
  assert.deepEqual(brief.seeds, ["https://www.trademe.co.nz/a/listing/1"]);
  assert.ok(brief.assumptions.some((line) => line.includes("provided URL")));
});

test("seeds and queries round-trip through YAML", () => {
  const brief = briefFromExtraction("find a laptop", {
    seeds: ["https://shop.test/listing/1"],
    queries: ["m2 macbook auckland"],
  });
  const again = parseBrief(serializeBrief(brief));
  assert.deepEqual(again.seeds, brief.seeds);
  assert.deepEqual(again.queries, brief.queries);
});

test("feedback can add source scope, seeds, and queries", () => {
  const brief = briefFromExtraction("find a laptop", {});
  const next = applyBriefDelta(brief, {
    action: "re-search",
    sources: { allow: ["trademe.co.nz"], web: "off" },
    seeds: ["https://shop.test/listing/2"],
    queries: ["m2 macbook auckland"],
  });
  assert.deepEqual(next.sources.allow, ["trademe.co.nz"]);
  assert.equal(next.sources.web, "off");
  assert.deepEqual(next.seeds, ["https://shop.test/listing/2"]);
  assert.deepEqual(next.queries, ["m2 macbook auckland"]);
});

test("compiler zero budgets fall back to defaults unless explicitly skipped", () => {
  const brief = briefFromExtraction("find a laptop", {
    budgets: { html_max: 0, text_max: 0 },
  });
  assert.equal(brief.budgets.htmlMax, 25);
  assert.equal(brief.budgets.textMax, 50);
  assert.ok(brief.warnings.some((warning) => warning.includes("html_max 0")));
  assert.ok(brief.warnings.some((warning) => warning.includes("text_max 0")));

  const skipped = briefFromExtraction(
    "find a laptop, structured-only, no text",
    { budgets: { html_max: 0, text_max: 0 } },
  );
  assert.equal(skipped.budgets.htmlMax, 0);
  assert.equal(skipped.budgets.textMax, 0);
});

test("compiler field hallucinations fall back to text", () => {
  const brief = briefFromExtraction("find an M2 macbook in Auckland", {
    criteria: [
      {
        key: "m2_macbook",
        label: "MacBook with an M2 chip",
        weight: 1,
        kind: "boolean",
        normalizer: { type: "boolean" },
        source: { type: "field", field: "m2_macbook" },
        origin: "explicit",
        hard: { op: "eq", value: true },
      },
      {
        key: "location_auckland",
        label: "Located in Auckland",
        weight: 1,
        kind: "enum",
        normalizer: { type: "enum", scores: { auckland: 1, other: 0 } },
        source: { type: "field", field: "location_auckland" },
        origin: "explicit",
        hard: { op: "eq", value: "Auckland" },
      },
      {
        key: "ram_gb",
        label: "RAM",
        weight: 1,
        kind: "number",
        normalizer: { type: "higher-is-better", max: 64 },
        source: { type: "field", field: "ram_gb" },
        origin: "explicit",
      },
    ],
  });

  assert.equal(
    brief.criteria.find((criterion) => criterion.key === "m2_macbook")?.source
      .type,
    "text",
  );
  assert.equal(
    brief.criteria.find((criterion) => criterion.key === "location_auckland")
      ?.source.type,
    "text",
  );
  assert.equal(
    brief.criteria.find((criterion) => criterion.key === "ram_gb")?.source.type,
    "field",
  );
  assert.ok(
    brief.warnings.some((warning) => warning.includes("evaluating")),
  );
});

test("alternative room wording removes a hard bedroom minimum and keeps the room criterion", () => {
  const brief = briefFromExtraction(
    "rental up to $600 with at least two rooms (2 bedrooms OR 1 bedroom plus a study) near 64C Stoddard Road",
    {
      hard: { rent_max: 600, bedrooms: { min: 2 } },
      criteria: [
        {
          key: "two_rooms",
          label: "At least two rooms",
          weight: 1,
          kind: "boolean",
          normalizer: { type: "boolean" },
          source: {
            type: "text",
            prompt:
              "Return true for 2+ bedrooms or 1 bedroom plus a separate study.",
          },
          origin: "explicit",
          hard: { op: "eq", value: true },
        },
      ],
    },
  );

  assert.equal(brief.hard.bedrooms, undefined);
  assert.equal(
    brief.criteria.find((criterion) => criterion.key === "two_rooms")?.hard?.op,
    "eq",
  );
  assert.equal(brief.domain, "property");
  assert.ok(
    brief.warnings.some((warning) => warning.includes("alternative room")),
  );
});

test("implicit currency criteria are removed and fuel criteria get cost parameters", () => {
  const brief = briefFromExtraction(
    "rental under $600 near 64C Stoddard Road, petrol $3.30 NZD/L, Mazda 3 8L/100km, 5-day round-trip commute",
    {
      anchors: { work: { address: "64C Stoddard Road, Auckland" } },
      hard: { rent_max: 600 },
      criteria: [
        {
          key: "rent_currency",
          label: "Rent currency",
          weight: 0.9,
          kind: "enum",
          normalizer: { type: "enum", scores: { NZD: 1, other: 0 } },
          source: { type: "field", field: "currency" },
          origin: "explicit",
          hard: { op: "eq", value: "NZD" },
        },
        {
          key: "weekly_petrol_cost",
          label: "Weekly petrol cost",
          weight: 0.9,
          kind: "number",
          normalizer: { type: "lower-is-better", max: 100 },
          source: { type: "derived", evaluator: "commute" },
          origin: "explicit",
        },
        {
          key: "total_weekly_cost",
          label: "Total weekly cost",
          weight: 1,
          kind: "number",
          normalizer: { type: "lower-is-better", max: 700 },
          source: { type: "derived", evaluator: "commute" },
          origin: "explicit",
        },
      ],
    },
  );

  assert.equal(
    brief.criteria.some((criterion) => criterion.key === "rent_currency"),
    false,
  );
  const fuel = brief.criteria.find(
    (criterion) => criterion.key === "weekly_petrol_cost",
  );
  assert.equal(fuel?.source.type, "derived");
  if (fuel?.source.type === "derived") {
    assert.equal(fuel.source.params?.metric, "fuel_cost");
    assert.equal(fuel.source.params?.fuel_l_per_100km, 8);
    assert.equal(fuel.source.params?.fuel_price_per_litre, 3.3);
    assert.equal(fuel.source.params?.days_per_week, 5);
    assert.equal(fuel.source.params?.round_trip, true);
  }
  const total = brief.criteria.find(
    (criterion) => criterion.key === "total_weekly_cost",
  );
  if (total?.source.type === "derived") {
    assert.equal(total.source.params?.metric, "total_cost");
  }
});
