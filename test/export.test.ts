import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BUDGETS, type Brief } from "../src/brief/types.ts";
import type { Listing } from "../src/campaign/types.ts";
import { propertyPack } from "../src/domain/property.ts";
import {
  buildExportTable,
  tableToCsv,
  type ExportItem,
  type ExportTable,
} from "../src/export/csv.ts";
import type { ScoreResult } from "../src/scoring/score.ts";

const BRIEF: Brief = {
  version: 1,
  domain: "property",
  prompt: "test",
  anchors: {},
  hard: {},
  soft: [
    { key: "parking", weight: 0.5 },
    { key: "sunlight", weight: 0.5 },
  ],
  unknownPolicy: "flag",
  budgets: DEFAULT_BUDGETS,
  assumptions: [],
};

function listing(id: number, url: string): Listing {
  return {
    id,
    source: "trademe",
    externalId: String(id),
    url,
    firstSeen: "2026-10-01T00:00:00.000Z",
    lastSeen: "2026-10-01T00:00:00.000Z",
    status: "active",
    raw: {},
  };
}

function result(
  score: number,
  hardPass = true,
  overrides: Partial<ScoreResult> = {},
): ScoreResult {
  return {
    score,
    coverage: 1,
    hardPass,
    hardFailures: [],
    breakdown: [],
    gaps: [],
    questions: [],
    notes: [],
    ...overrides,
  };
}

function item(
  id: number,
  score: number,
  hardPass = true,
  url = `https://example.test/${id}`,
): ExportItem {
  return {
    listing: listing(id, url),
    facts: new Map(),
    result: result(score, hardPass),
  };
}

test("builds core, criterion, and tail columns", () => {
  const table = buildExportTable([item(1, 0.8)], BRIEF, propertyPack);
  const labels = table.columns.map((column) => column.label);
  assert.deepEqual(labels.slice(0, 5), [
    "Rank",
    "Score",
    "Coverage",
    "Hard pass",
    "Hard failures",
  ]);
  assert.ok(labels.includes("Parking"));
  assert.ok(labels.includes("Sunlight"));
  assert.ok(labels.includes("Unknowns"));
  assert.ok(labels.includes("URL"));
});

test("ranks passing listings and sends failures to the bottom", () => {
  const table = buildExportTable(
    [item(1, 0.5), item(2, 0.9), item(3, 0.7, false)],
    BRIEF,
    propertyPack,
  );
  assert.deepEqual(
    table.rows.map((row) => row.listing_id),
    [2, 1, 3],
  );
  assert.deepEqual(
    table.rows.map((row) => row.rank),
    [1, 2, null],
  );
});

test("scores inside the tie band share a rank", () => {
  const table = buildExportTable(
    [item(1, 0.8), item(2, 0.82), item(3, 0.7)],
    BRIEF,
    propertyPack,
  );
  assert.deepEqual(
    table.rows.map((row) => row.rank),
    [1, 1, 3],
  );
});

test("missing facts render as empty cells and gaps render readably", () => {
  const withGap: ExportItem = {
    listing: listing(1, "https://example.test/1"),
    facts: new Map([
      [
        "sunlight",
        {
          key: "sunlight",
          value: "high",
          sourceType: "image",
          sourceRef: "sha256:abc",
          confidence: 0.9,
          observedAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    ]),
    result: result(0.8, true, {
      gaps: [{ key: "parking", label: "Parking", reason: "missing", investigate: false }],
      questions: ["Can you confirm parking?"],
    }),
  };
  const table = buildExportTable([withGap], BRIEF, propertyPack);
  const row = table.rows[0]!;
  assert.equal(row["criterion:parking"], null);
  assert.equal(row["criterion:sunlight"], "high");
  assert.equal(row.gaps, "Parking (missing)");
  assert.equal(row.questions, "Can you confirm parking?");
});

test("csv escapes quotes, commas, and newlines, and blocks formulas", () => {
  const table: ExportTable = {
    columns: [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
      { key: "c", label: "C" },
    ],
    rows: [
      { a: 'says "hi", ok', b: "line\nbreak", c: "=HYPERLINK(\"x\")" },
      { a: -5, b: true, c: null },
    ],
  };
  const csv = tableToCsv(table);
  const expected =
    'A,B,C\n' +
    '"says ""hi"", ok","line\nbreak","\'=HYPERLINK(""x"")"\n' +
    "-5,true,\n";
  assert.equal(csv, expected);
});
