import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { CampaignStore } from "../src/campaign/store.ts";

const stores: CampaignStore[] = [];
function store(): CampaignStore {
  const s = CampaignStore.open(":memory:");
  stores.push(s);
  return s;
}
after(() => {
  for (const s of stores) s.close();
});

test("upsertListing dedupes on source and external id", () => {
  const s = store();
  const first = s.upsertListing({
    source: "trademe",
    externalId: "123",
    url: "https://example.test/1",
    raw: { price: 600 },
  });
  const second = s.upsertListing({
    source: "trademe",
    externalId: "123",
    url: "https://example.test/1-updated",
    raw: { price: 590 },
  });

  assert.equal(first.id, second.id);
  assert.equal(first.firstSeen, second.firstSeen);
  assert.equal(second.url, "https://example.test/1-updated");
  assert.deepEqual(second.raw, { price: 590 });
  assert.equal(s.listListings().length, 1);
});

test("evidence keeps history and latestEvidence picks the newest observation", () => {
  const s = store();
  const listing = s.upsertListing({
    source: "trademe",
    externalId: "1",
    url: "https://example.test/1",
  });

  s.addEvidence({
    listingId: listing.id,
    key: "heat_pump",
    value: false,
    sourceType: "page",
    sourceRef: "recipe:trademe@1",
    confidence: 0.5,
    observedAt: "2026-10-01T00:00:00.000Z",
  });
  s.addEvidence({
    listingId: listing.id,
    key: "heat_pump",
    value: true,
    sourceType: "user",
    sourceRef: "feedback:1",
    confidence: 1,
    observedAt: "2026-10-02T00:00:00.000Z",
  });
  s.addEvidence({
    listingId: listing.id,
    key: "sunlight",
    value: { level: "high", direction: "north" },
    sourceType: "image",
    sourceRef: "sha256:abc",
    confidence: 0.7,
  });

  assert.equal(s.listEvidence(listing.id).length, 3);
  const latest = s.latestEvidence(listing.id);
  assert.equal(latest.get("heat_pump")?.value, true);
  assert.deepEqual(latest.get("sunlight")?.value, {
    level: "high",
    direction: "north",
  });
});

test("brief versions and scores are versioned per brief", () => {
  const s = store();
  const listing = s.upsertListing({
    source: "trademe",
    externalId: "1",
    url: "https://example.test/1",
  });
  const b1 = s.saveBrief("version: 1", "find a rental");
  const b2 = s.saveBrief("version: 2", "find a cheaper rental");

  s.saveScore({
    listingId: listing.id,
    briefVersionId: b1.id,
    score: 0.4,
    coverage: 0.8,
    hardPass: true,
    breakdown: [{ key: "rent", contribution: 0.4 }],
  });
  s.saveScore({
    listingId: listing.id,
    briefVersionId: b2.id,
    score: 0.9,
    coverage: 0.9,
    hardPass: true,
    breakdown: [{ key: "rent", contribution: 0.9 }],
  });
  s.saveScore({
    listingId: listing.id,
    briefVersionId: b2.id,
    score: 0.95,
    coverage: 0.9,
    hardPass: true,
    breakdown: [],
  });

  assert.equal(s.listScores(b1.id).length, 1);
  assert.equal(s.listScores(b2.id).length, 1);
  assert.equal(s.listScores(b2.id)[0]?.score, 0.95);
  assert.equal(s.latestBrief()?.id, b2.id);
});

test("feedback starts unapplied and can be marked applied", () => {
  const s = store();
  const f = s.addFeedback("drop anything without a carpark", "re-score", {
    hard: { carpark: true },
  });

  assert.equal(f.appliedAt, null);
  assert.deepEqual(f.delta, { hard: { carpark: true } });
  s.markFeedbackApplied(f.id);
  assert.notEqual(s.getFeedback(f.id)?.appliedAt, null);
});

test("runs checkpoint, resume, and finish", () => {
  const s = store();
  const run = s.startRun();
  assert.equal(run.cursor, null);

  s.checkpointRun(run.id, "page:2", 1.25);
  let loaded = s.getRun(run.id);
  assert.equal(loaded?.cursor, "page:2");
  assert.equal(loaded?.spendUsd, 1.25);

  s.finishRun(run.id, "budget");
  loaded = s.getRun(run.id);
  assert.equal(loaded?.stopReason, "budget");
  assert.notEqual(loaded?.endedAt, null);
});

test("media is keyed by content hash and listing", () => {
  const s = store();
  const listing = s.upsertListing({
    source: "trademe",
    externalId: "1",
    url: "https://example.test/1",
  });

  s.addMedia("sha256:abc", listing.id, "/tmp/abc.jpg");
  const media = s.getMedia("sha256:abc");
  assert.equal(media?.listingId, listing.id);
  assert.equal(media?.path, "/tmp/abc.jpg");
});

test("recipes upsert by id", () => {
  const s = store();
  s.saveRecipe({ id: "trademe", domain: "property", version: 1, code: "v1" });
  s.saveRecipe({ id: "trademe", domain: "property", version: 2, code: "v2" });
  assert.equal(s.getRecipe("trademe")?.version, 2);
});

test("data survives closing and reopening a file", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-store-"));
  const path = join(dir, "nested", "campaign.db");
  try {
    const first = CampaignStore.open(path);
    first.upsertListing({
      source: "trademe",
      externalId: "1",
      url: "https://example.test/1",
    });
    first.close();

    const second = CampaignStore.open(path);
    assert.equal(second.listListings().length, 1);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("latestRun returns the newest run", () => {
  const s = store();
  const first = s.startRun();
  s.finishRun(first.id, "paused");
  const second = s.startRun();
  assert.equal(s.latestRun()?.id, second.id);
});
