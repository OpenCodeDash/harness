import assert from "node:assert/strict";
import { test } from "node:test";
import { compileBrief } from "../src/brief/brief.ts";
import {
  buildBriefPrompt,
  ResponsesBriefExtractor,
} from "../src/brief/extractor.ts";
import { parseArgs } from "../src/cli.ts";
import type { ResponsesClient } from "../src/vision/responses.ts";

test("brief extractor strips nulls and turns required pairs into a map", async () => {
  const client = {
    async structured() {
      return {
        data: {
          hard: {
            rent_max: 650,
            bedrooms: { min: 2, max: null },
            areas: null,
            required: [{ key: "parking", value: true }],
          },
          anchors: {
            work: null,
            commute: { mode: "drive", max_minutes: 25, hard: false },
          },
          criteria: [
            {
              key: "parking",
              label: "Parking",
              weight: 0.9,
              kind: "boolean",
              normalizer: { type: "boolean", prefer: true },
              source: { type: "field", field: "parking" },
              origin: "explicit",
              hard: null,
              unknown: null,
              rationale: null,
            },
          ],
          unknown_policy: "flag",
          budgets: {
            max_listings: 300,
            max_usd: 15,
            max_minutes: 120,
            vision_max: 60,
          },
          assumptions: ["near work means <=25 min drive"],
        },
      };
    },
  } as unknown as ResponsesClient;

  const extractor = new ResponsesBriefExtractor(client, "model");
  const raw = (await extractor.extract({
    prompt: "2 bed under 650 near work",
  })) as {
    hard: { required: unknown; bedrooms: { min: number; max?: number }; areas?: unknown };
    anchors: { work?: unknown };
  };

  assert.deepEqual(raw.hard.required, { parking: true });
  assert.deepEqual(raw.hard.bedrooms, { min: 2 });
  assert.equal(raw.hard.areas, undefined);
  assert.equal(raw.anchors.work, undefined);
});

test("compiled briefs from the extractor flow into the compiler", async () => {
  const client = {
    async structured() {
      return {
        data: {
          hard: {
            rent_max: 650,
            bedrooms: { min: 2, max: 3 },
            areas: ["Wellington"],
            required: [{ key: "parking", value: true }],
          },
          anchors: {
            work: { address: "1 Lambton Quay", lat: null, lon: null },
            commute: { mode: "drive", max_minutes: 25, hard: false },
          },
          criteria: [
            {
              key: "parking",
              label: "Parking",
              weight: 0.95,
              kind: "boolean",
              normalizer: { type: "boolean", prefer: true },
              source: { type: "field", field: "parking" },
              origin: "explicit",
              hard: null,
              unknown: null,
              rationale: null,
            },
          ],
          unknown_policy: "flag",
          budgets: {
            max_listings: 120,
            max_usd: 10,
            max_minutes: 60,
            vision_max: 25,
          },
          assumptions: [],
        },
      };
    },
  } as unknown as ResponsesClient;

  const brief = await compileBrief(
    "2-3 bed under 650 near work, want a carpark",
    new ResponsesBriefExtractor(client, "model"),
  );

  assert.equal(brief.hard.rentMax, 650);
  assert.deepEqual(brief.hard.areas, ["Wellington"]);
  assert.equal(brief.hard.required?.parking, true);
  assert.equal(brief.anchors.commute?.maxMinutes, 25);
  assert.equal(brief.budgets.maxListings, 120);
  assert.equal(
    brief.criteria.find((criterion) => criterion.key === "parking")?.weight,
    0.95,
  );
});

test("brief prompt lists the core vocabulary", () => {
  const prompt = buildBriefPrompt("find a rental");
  assert.match(prompt, /price \(Price, number\)/);
  assert.match(prompt, /condition \(Condition, enum\)/);
  assert.match(prompt, /Do not pad/);
});

test("CLI argument parsing applies defaults and flags", () => {
  const base = parseArgs(["--prompt", "find a rental"]);
  assert.equal(base.db, "campaigns/default/campaign.db");
  assert.equal(base.exportPath, "campaigns/default/exports/latest.csv");
  assert.equal(base.mediaDir, "campaigns/default/media");
  assert.equal(base.now, false);
  assert.equal(base.waitSeconds, 60);

  const custom = parseArgs([
    "--db",
    "/tmp/campaign/campaign.db",
    "--prompt",
    "x",
    "--serve",
    "--now",
    "--no-vision",
    "--no-details",
    "--wait",
    "5",
  ]);
  assert.equal(custom.db, "/tmp/campaign/campaign.db");
  assert.equal(custom.exportPath, "/tmp/campaign/exports/latest.csv");
  assert.equal(custom.mediaDir, "/tmp/campaign/media");
  assert.equal(custom.serve, 7331);
  assert.equal(custom.now, true);
  assert.equal(custom.noVision, true);
  assert.equal(custom.noDetails, true);
  assert.equal(custom.waitSeconds, 5);

  const port = parseArgs(["--prompt", "x", "--serve", "9000"]);
  assert.equal(port.serve, 9000);

  assert.throws(() => parseArgs(["--nope"]), /unknown argument/);
  assert.throws(() => parseArgs(["--db"]), /requires a value/);
});

test("brief extractor drops incomplete commute and work anchors", async () => {
  const client = {
    async structured() {
      return {
        data: {
          hard: { rent_max: null, bedrooms: { min: null, max: null }, areas: null, required: null },
          anchors: {
            work: { address: null, lat: null, lon: null },
            commute: { mode: "drive", max_minutes: null, hard: false },
          },
          criteria: [],
          unknown_policy: "flag",
          budgets: { max_listings: 1, max_usd: 1, max_minutes: 1, vision_max: 0 },
          assumptions: [],
        },
      };
    },
  } as unknown as ResponsesClient;

  const raw = (await new ResponsesBriefExtractor(client, "m").extract({
    prompt: "cheap rental",
  })) as { anchors: { work?: unknown; commute?: unknown }; hard: { bedrooms?: unknown } };

  assert.equal(raw.anchors.work, undefined);
  assert.equal(raw.anchors.commute, undefined);
  assert.equal(raw.hard?.bedrooms, undefined);
});
