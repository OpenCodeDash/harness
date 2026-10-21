import assert from "node:assert/strict";
import { test } from "node:test";
import { briefFromExtraction, serializeBrief } from "../src/brief/brief.ts";
import { CampaignStore } from "../src/campaign/store.ts";
import { createControlServer, type ControlState } from "../src/control/api.ts";

async function withServer(
  setup: (state: ControlState) => void,
  run: (baseUrl: string, state: ControlState) => Promise<void>,
): Promise<void> {
  const store = CampaignStore.open(":memory:");
  const brief = briefFromExtraction("rental", {
    hard: { rent_max: 650, bedrooms: { min: 2 }, areas: ["Wellington"] },
    criteria: [
      {
        key: "parking",
        label: "Parking",
        weight: 0.5,
        kind: "boolean",
        normalizer: { type: "boolean" },
        source: { type: "field", field: "parking" },
        origin: "explicit",
      },
    ],
  });
  const state: ControlState = { store, brief, paused: false };
  store.saveBrief(serializeBrief(brief), brief.prompt);
  setup(state);
  const server = createControlServer(state);
  const port = await server.listen(0);
  try {
    await run(`http://127.0.0.1:${port}`, state);
  } finally {
    await server.close();
    store.close();
  }
}

function seed(store: CampaignStore) {
  const listing = store.upsertListing({
    source: "trademe",
    externalId: "1",
    url: "https://www.trademe.co.nz/a/property/residential/rent/wellington/x/listing/1",
  });
  store.addEvidence({
    listingId: listing.id,
    key: "rent",
    value: 700,
    sourceType: "page",
    sourceRef: "test",
    confidence: 1,
  });
  store.addEvidence({
    listingId: listing.id,
    key: "parking",
    value: true,
    sourceType: "page",
    sourceRef: "test",
    confidence: 1,
  });
  store.addEvidence({
    listingId: listing.id,
    key: "bedrooms",
    value: 2,
    sourceType: "page",
    sourceRef: "test",
    confidence: 1,
  });
  store.addEvidence({
    listingId: listing.id,
    key: "suburb",
    value: "Wellington",
    sourceType: "page",
    sourceRef: "test",
    confidence: 1,
  });
}

test("status reports the brief and current counts", async () => {
  await withServer(
    ({ store }) => seed(store),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/status`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.counts.listings, 1);
      assert.equal(body.counts.hardPass, 0);
      assert.match(body.brief, /rent <= 650/);
      assert.equal(body.paused, false);
    },
  );
});

test("feedback re-scores existing listings without re-searching", async () => {
  await withServer(
    ({ store }) => seed(store),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "raise the rent limit to 800" }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.changed, true);
      assert.equal(body.action, "re-score");
      assert.equal(body.rescored, 1);
      assert.match(body.summary, /rent <= 800/);

      const status = await (await fetch(`${baseUrl}/status`)).json();
      assert.equal(status.counts.hardPass, 1);
      assert.equal(status.briefVersion, 2);
    },
  );
});

test("pause and resume flip the control flag and call the resumer", async () => {
  let resumedRun = 0;
  await withServer(
    (state) => {
      state.runId = 7;
      state.onResume = async (runId) => {
        resumedRun = runId;
        return { runId, stopReason: "complete" };
      };
    },
    async (baseUrl) => {
      await fetch(`${baseUrl}/pause`, { method: "POST" });
      let status = await (await fetch(`${baseUrl}/status`)).json();
      assert.equal(status.paused, true);

      await fetch(`${baseUrl}/resume`, { method: "POST" });
      status = await (await fetch(`${baseUrl}/status`)).json();
      assert.equal(status.paused, false);
      assert.equal(resumedRun, 7);
    },
  );
});

test("re-search feedback starts a new run", async () => {
  let researchBrief: unknown = null;
  await withServer(
    (state) => {
      state.onResearch = async (brief) => {
        researchBrief = brief;
        return { runId: 99, stopReason: "complete" };
      };
    },
    async (baseUrl, state) => {
      const response = await fetch(`${baseUrl}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "also look at Petone" }),
      });
      const body = await response.json();
      assert.equal(body.action, "re-search");
      assert.equal(state.runId, 99);
      assert.ok(
        (researchBrief as { hard: { areas: string[] } }).hard.areas.includes(
          "Petone",
        ),
      );
    },
  );
});

test("export returns CSV and bad feedback is rejected", async () => {
  await withServer(
    ({ store }) => seed(store),
    async (baseUrl) => {
      const csv = await fetch(`${baseUrl}/export.csv`);
      assert.equal(csv.status, 200);
      assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
      assert.match(await csv.text(), /^Rank,Score,Coverage,Hard pass/m);

      const bad = await fetch(`${baseUrl}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "   " }),
      });
      assert.equal(bad.status, 400);

      const missing = await fetch(`${baseUrl}/nope`);
      assert.equal(missing.status, 404);
    },
  );
});

test("control API requires a bearer token when configured", async () => {
  await withServer(
    (state) => {
      state.token = "secret";
    },
    async (baseUrl) => {
      const denied = await fetch(`${baseUrl}/status`);
      assert.equal(denied.status, 401);

      const allowed = await fetch(`${baseUrl}/status`, {
        headers: { authorization: "Bearer secret" },
      });
      assert.equal(allowed.status, 200);
    },
  );
});
