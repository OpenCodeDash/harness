import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { briefFromExtraction } from "../src/brief/brief.ts";
import { CampaignManager } from "../src/daemon/manager.ts";
import { createDaemonServer } from "../src/daemon/server.ts";
import type { SearchProvider } from "../src/discovery/searxng.ts";
import { propertyPack } from "../src/domain/property.ts";
import type { BrowserProvider, RunnerPage } from "../src/runner/loop.ts";

const SEARCH_URL =
  "https://www.trademe.co.nz/a/property/residential/rent/wellington/search";
const LISTING_1 =
  "https://www.trademe.co.nz/a/property/residential/rent/wellington/x/listing/1";
const LISTING_2 =
  "https://www.trademe.co.nz/a/property/residential/rent/wellington/x/listing/2";

function item(externalId: string, url: string, rent: number) {
  return {
    source: "trademe",
    externalId,
    url,
    fields: {
      rent,
      bedrooms: 2,
      bathrooms: 1,
      parking: true,
      address: `${externalId} Test Street`,
      suburb: "Wellington",
      district: "Wellington",
      description: "Heat pump. No pets.",
    },
    media: ["https://img.test/1.jpg"],
    raw: {},
  };
}

class FakePage implements RunnerPage {
  constructor(private readonly data: unknown) {}
  async waitFor(): Promise<void> {}
  async evaluate<T>(): Promise<T> {
    return this.data as T;
  }
  async close(): Promise<void> {}
}

class FakeBrowser implements BrowserProvider {
  constructor(private readonly handler: (url: string) => unknown) {}
  async newPage(url: string): Promise<RunnerPage> {
    return new FakePage(this.handler(url));
  }
}

class FakeSearch implements SearchProvider {
  constructor(private readonly urls: string[]) {}
  async search() {
    return this.urls.map((url) => ({ title: "", url, snippet: "" }));
  }
}

function makeBrief() {
  return briefFromExtraction("demo", propertyPack, {
    hard: {
      rent_max: 650,
      bedrooms: { min: 1, max: 4 },
      areas: ["Wellington"],
    },
    soft: [{ key: "parking", weight: 0.5 }],
    budgets: { max_listings: 10, max_usd: 15, max_minutes: 5, vision_max: 5 },
  });
}

function makeBrowser(): FakeBrowser {
  return new FakeBrowser((url) =>
    url === SEARCH_URL
      ? [item("1", LISTING_1, 600), item("2", LISTING_2, 900)]
      : null,
  );
}

function makeManager(root: string, browser = makeBrowser()): CampaignManager {
  return new CampaignManager({
    root,
    visitDetails: false,
    providers: {
      browser,
      search: new FakeSearch([SEARCH_URL]),
    },
    compileBrief: async () => makeBrief(),
  });
}

test("manager runs a campaign, emits events, and exposes results", async () => {
  const root = mkdtempSync(join(tmpdir(), "harness-daemon-"));
  const manager = makeManager(root);
  await manager.open();
  try {
    const runtime = await manager.create({ prompt: "demo", name: "demo" });
    const events: string[] = [];
    runtime.events.on("event", (event: { type: string }) =>
      events.push(event.type),
    );

    manager.start(runtime.record.id);
    await manager.waitForIdle();

    const results = manager.results(runtime.record.id);
    assert.equal(results.counts.listings, 2);
    assert.equal(results.counts.hardPass, 1);
    assert.equal(results.rows[0]?.rank, 1);
    assert.equal(results.rows[1]?.rank, null);
    assert.match(manager.exportCsv(runtime.record.id), /^Rank,Score/m);
    assert.equal(manager.list().length, 1);
    assert.ok(events.includes("run.started"));
    assert.ok(events.includes("run.finished"));
  } finally {
    manager.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("manager reloads campaigns and briefs from disk", async () => {
  const root = mkdtempSync(join(tmpdir(), "harness-daemon-"));
  let manager = makeManager(root);
  await manager.open();
  const runtime = await manager.create({ prompt: "demo", name: "demo" });
  const id = runtime.record.id;
  manager.start(id);
  await manager.waitForIdle();
  manager.close();

  manager = makeManager(root);
  await manager.open();
  try {
    const loaded = manager.get(id);
    assert.ok(loaded);
    assert.equal(manager.results(id).counts.listings, 2);
    assert.equal(loaded?.brief.hard.rentMax, 650);
    assert.equal(loaded?.runId, 1);
    assert.equal(loaded?.lastSummary?.stopReason, "complete");
    assert.equal(loaded?.lastSummary?.discovered, 1);
    assert.equal(loaded?.lastSummary?.collected, 2);
  } finally {
    manager.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("feedback re-scores without re-running discovery", async () => {
  const root = mkdtempSync(join(tmpdir(), "harness-daemon-"));
  const manager = makeManager(root);
  await manager.open();
  try {
    const runtime = await manager.create({ prompt: "demo", name: "demo" });
    manager.start(runtime.record.id);
    await manager.waitForIdle();
    assert.equal(manager.results(runtime.record.id).counts.hardPass, 1);

    const feedback = manager.feedback(
      runtime.record.id,
      "raise the rent limit to 1000",
    );
    assert.equal(feedback.changed, true);
    assert.equal(feedback.action, "re-score");
    assert.equal(manager.results(runtime.record.id).counts.hardPass, 2);
  } finally {
    manager.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("pause, resume, and stop flip campaign flags", async () => {
  const root = mkdtempSync(join(tmpdir(), "harness-daemon-"));
  const manager = makeManager(root);
  await manager.open();
  try {
    const runtime = await manager.create({ prompt: "demo", name: "demo" });
    const id = runtime.record.id;
    manager.pause(id);
    assert.equal(manager.status(runtime).paused, true);
    manager.resume(id);
    assert.equal(manager.status(runtime).paused, false);
    manager.stop(id);
    assert.equal(manager.status(runtime).stopped, true);
  } finally {
    manager.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("daemon server authenticates and serves results, feedback, and SSE", async () => {
  const root = mkdtempSync(join(tmpdir(), "harness-daemon-"));
  const manager = makeManager(root);
  await manager.open();
  const server = createDaemonServer({ manager, token: "secret" });
  const port = await server.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: "Bearer secret" };

  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/campaigns`)).status, 401);

    const created = await fetch(`${base}/campaigns`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ prompt: "demo", name: "demo" }),
    });
    assert.equal(created.status, 202);
    const body = (await created.json()) as { campaign: { id: string } };
    const id = body.campaign.id;

    await manager.waitForIdle();

    const results = (await (
      await fetch(`${base}/campaigns/${id}/results`, { headers: auth })
    ).json()) as { counts: { listings: number } };
    assert.equal(results.counts.listings, 2);

    const csv = await fetch(`${base}/campaigns/${id}/export.csv`, {
      headers: auth,
    });
    assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);

    const feedback = (await (
      await fetch(`${base}/campaigns/${id}/feedback`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ text: "raise the rent limit to 1000" }),
      })
    ).json()) as { changed: boolean };
    assert.equal(feedback.changed, true);

    const list = (await (
      await fetch(`${base}/campaigns`, { headers: auth })
    ).json()) as { campaigns: unknown[] };
    assert.equal(list.campaigns.length, 1);

    const controller = new AbortController();
    const stream = await fetch(`${base}/campaigns/${id}/events`, {
      headers: auth,
      signal: controller.signal,
    });
    assert.match(stream.headers.get("content-type") ?? "", /text\/event-stream/);
    const reader = stream.body!.getReader();
    const chunk = await reader.read();
    assert.match(new TextDecoder().decode(chunk.value), /"type":"status"/);
    controller.abort();
  } finally {
    await server.close();
    manager.close();
    rmSync(root, { recursive: true, force: true });
  }
});
