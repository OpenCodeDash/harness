import assert from "node:assert/strict";
import { test } from "node:test";
import { briefFromExtraction } from "../src/brief/brief.ts";
import { CampaignStore } from "../src/campaign/store.ts";
import type { SearchProvider } from "../src/discovery/searxng.ts";
import { propertyPack } from "../src/domain/property.ts";
import {
  runCampaign,
  type BrowserProvider,
  type RunnerEvent,
  type RunnerPage,
} from "../src/runner/loop.ts";
import { extractDescriptionFacts } from "../src/runner/text.ts";

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
  calls: string[] = [];
  constructor(private readonly handler: (url: string) => unknown) {}
  async newPage(url: string): Promise<RunnerPage> {
    this.calls.push(url);
    return new FakePage(this.handler(url));
  }
}

class FakeSearch implements SearchProvider {
  constructor(private readonly urls: string[]) {}
  async search() {
    return this.urls.map((url) => ({ title: "", url, snippet: "" }));
  }
}

function makeBrief(overrides: Record<string, unknown> = {}) {
  const brief = briefFromExtraction("rental", propertyPack, {
    hard: {
      rent_max: 650,
      bedrooms: { min: 2, max: 3 },
      areas: ["Wellington"],
    },
    soft: [{ key: "parking", weight: 0.5 }],
    budgets: { max_listings: 10, max_usd: 15, max_minutes: 5, vision_max: 5 },
  });
  return { ...brief, ...overrides };
}

test("description extraction handles negation and special cases", () => {
  const facts = extractDescriptionFacts(
    "No heat pump. Unfurnished. Sorry, no pets. Off-street parking.",
    propertyPack,
  );
  const byKey = Object.fromEntries(facts.map((fact) => [fact.key, fact.value]));
  assert.equal(byKey.heat_pump, false);
  assert.equal(byKey.furnished, false);
  assert.equal(byKey.pets, "no");
  assert.equal(byKey.parking, true);

  const positive = extractDescriptionFacts(
    "Heat pump installed, pets negotiable, furnished.",
    propertyPack,
  );
  const positiveByKey = Object.fromEntries(
    positive.map((fact) => [fact.key, fact.value]),
  );
  assert.equal(positiveByKey.heat_pump, true);
  assert.equal(positiveByKey.pets, "negotiable");
  assert.equal(positiveByKey.furnished, true);
});

test("campaign collects, extracts, scores, and exports", async () => {
  const store = CampaignStore.open(":memory:");
  const browser = new FakeBrowser((url) =>
    url === SEARCH_URL
      ? [item("1", LISTING_1, 600), item("2", LISTING_2, 900)]
      : null,
  );
  try {
    const summary = await runCampaign(
      { store, browser, search: new FakeSearch([SEARCH_URL]), visitDetails: false },
      { brief: makeBrief(), pack: propertyPack },
    );

    assert.equal(summary.stopReason, "complete");
    assert.equal(summary.discovered, 1);
    assert.equal(summary.collected, 2);
    assert.equal(summary.hardPass, 1);
    assert.equal(summary.shortlisted, 1);
    assert.equal(store.listListings().length, 2);

    const lease = store.findListing("trademe", "1")!;
    const evidence = store.listEvidence(lease.id);
    assert.ok(
      evidence.some(
        (entry) =>
          entry.key === "description" &&
          entry.value === "Heat pump. No pets.",
      ),
    );

    assert.match(summary.csv, /^Rank,Score,Coverage,Hard pass/m);
    assert.ok(summary.csv.includes(LISTING_1));
    assert.ok(store.listScores(store.latestBrief()!.id).length === 2);
  } finally {
    store.close();
  }
});

test("dynamic text and derived criteria produce evidence", async () => {
  const store = CampaignStore.open(":memory:");
  const browser = new FakeBrowser((url) =>
    url === SEARCH_URL ? [item("1", LISTING_1, 600)] : null,
  );
  const brief = briefFromExtraction("rental", propertyPack, {
    hard: {
      rent_max: 650,
      bedrooms: { min: 1, max: 4 },
      areas: ["Wellington"],
    },
    criteria: [
      {
        key: "pets",
        label: "Pets",
        weight: 0.5,
        kind: "enum",
        normalizer: { type: "enum", scores: { no: 0, negotiable: 0.5, yes: 1 } },
        source: { type: "text", prompt: "What is the pet policy?" },
        origin: "explicit",
      },
      {
        key: "price_per_bedroom",
        label: "Price per bedroom",
        weight: 0.5,
        kind: "number",
        normalizer: { type: "lower-is-better", max: 400 },
        source: { type: "derived", evaluator: "price_per_bedroom" },
        origin: "suggested",
      },
    ],
  });
  try {
    await runCampaign(
      {
        store,
        browser,
        search: new FakeSearch([SEARCH_URL]),
        visitDetails: false,
        text: {
          model: "test",
          async extract() {
            return [{ key: "pets", value: "no", confidence: 0.9 }];
          },
        },
      },
      { brief, pack: propertyPack },
    );

    const listing = store.findListing("trademe", "1")!;
    const evidence = store.listEvidence(listing.id);
    assert.ok(
      evidence.some(
        (entry) =>
          entry.key === "pets" &&
          entry.value === "no" &&
          entry.sourceType === "inference",
      ),
    );
    assert.ok(
      evidence.some(
        (entry) =>
          entry.key === "price_per_bedroom" &&
          entry.value === 300 &&
          entry.sourceType === "inference",
      ),
    );
  } finally {
    store.close();
  }
});

test("pause stops at a boundary and resume continues from the cursor", async () => {
  const store = CampaignStore.open(":memory:");
  const searchUrls = [
    `${SEARCH_URL}?page=1`,
    `${SEARCH_URL}?page=2`,
  ];
  const browser = new FakeBrowser((url) =>
    url === searchUrls[0]
      ? [item("1", LISTING_1, 600)]
      : url === searchUrls[1]
        ? [item("2", LISTING_2, 620)]
        : null,
  );
  try {
    let calls = 0;
    const first = await runCampaign(
      {
        store,
        browser,
        search: new FakeSearch(searchUrls),
        visitDetails: false,
        control: {
          paused: () => {
            calls += 1;
            return calls > 1;
          },
        },
      },
      { brief: makeBrief(), pack: propertyPack },
    );
    assert.equal(first.stopReason, "paused");
    assert.equal(first.collected, 1);

    const resumed = await runCampaign(
      {
        store,
        browser,
        search: new FakeSearch(searchUrls),
        visitDetails: false,
      },
      { brief: makeBrief(), pack: propertyPack, resumeRunId: first.runId },
    );
    assert.equal(resumed.stopReason, "complete");
    assert.equal(store.listListings().length, 2);
  } finally {
    store.close();
  }
});

test("detail visits add description-derived facts", async () => {
  const store = CampaignStore.open(":memory:");
  const browser = new FakeBrowser((url) => {
    if (url === SEARCH_URL) return [item("1", LISTING_1, 600)];
    if (url === LISTING_1) {
      return {
        source: "trademe",
        externalId: "1",
        url: LISTING_1,
        fields: { description: "No heat pump. Pets allowed.", address: "1 Test Street" },
        media: [],
        raw: {},
      };
    }
    return null;
  });
  try {
    await runCampaign(
      { store, browser, search: new FakeSearch([SEARCH_URL]), visitDetails: true, detailLimit: 1 },
      { brief: makeBrief(), pack: propertyPack },
    );
    const listing = store.findListing("trademe", "1")!;
    const latest = store.latestEvidence(listing.id);
    assert.equal(
      latest.get("description")?.value,
      "No heat pump. Pets allowed.",
    );
  } finally {
    store.close();
  }
});

test("vision runs on candidates and records image evidence with provenance", async () => {
  const store = CampaignStore.open(":memory:");
  const browser = new FakeBrowser((url) =>
    url === SEARCH_URL ? [item("1", LISTING_1, 600)] : null,
  );
  let extracted = 0;
  const brief = briefFromExtraction("rental", propertyPack, {
    hard: {
      rent_max: 650,
      bedrooms: { min: 1, max: 4 },
      areas: ["Wellington"],
    },
    criteria: [
      {
        key: "sunlight",
        label: "Sunlight",
        weight: 0.6,
        kind: "enum",
        normalizer: {
          type: "enum",
          scores: { none: 0, low: 0.33, moderate: 0.66, high: 1 },
        },
        source: {
          type: "image",
          prompt: "Judge direct sunlight visible in the photo.",
          options: ["none", "low", "moderate", "high"],
        },
        origin: "explicit",
      },
    ],
  });
  try {
    await runCampaign(
      {
        store,
        browser,
        search: new FakeSearch([SEARCH_URL]),
        visitDetails: false,
        photosPerListing: 1,
        cacheImage: async () => ({
          hash: "abc123",
          path: "/tmp/abc123.jpg",
          mimeType: "image/jpeg",
        }),
        vision: {
          model: "vision-model",
          async extract() {
            extracted += 1;
            return [
              {
                key: "sunlight",
                value: "high",
                confidence: 0.9,
                sourceRef: "sha256:abc123",
              },
            ];
          },
        },
      },
      { brief, pack: propertyPack },
    );

    assert.equal(extracted, 1);
    const listing = store.findListing("trademe", "1")!;
    const imageFacts = store
      .listEvidence(listing.id)
      .filter((entry) => entry.sourceType === "image");
    assert.equal(imageFacts.length, 1);
    assert.equal(imageFacts[0]?.key, "sunlight");
    assert.equal(imageFacts[0]?.sourceRef, "sha256:abc123");
    assert.equal(store.getMedia("abc123")?.listingId, listing.id);
  } finally {
    store.close();
  }
});

test("collection stops at the listing budget", async () => {
  const store = CampaignStore.open(":memory:");
  const browser = new FakeBrowser((url) =>
    url === SEARCH_URL
      ? [item("1", LISTING_1, 600), item("2", LISTING_2, 620)]
      : null,
  );
  try {
    const summary = await runCampaign(
      { store, browser, search: new FakeSearch([SEARCH_URL]), visitDetails: false },
      {
        brief: makeBrief({
          budgets: { maxListings: 1, maxUsd: 15, maxMinutes: 5, visionMax: 5 },
        }),
        pack: propertyPack,
      },
    );
    assert.equal(summary.stopReason, "budget");
    assert.equal(summary.collected, 1);
  } finally {
    store.close();
  }
});

test("detail visits only enrich ingested listings under the budget", async () => {
  const store = CampaignStore.open(":memory:");
  const browser = new FakeBrowser((url) =>
    url === SEARCH_URL
      ? [item("1", LISTING_1, 600), item("2", LISTING_2, 620)]
      : url === LISTING_1
        ? {
            source: "trademe",
            externalId: "1",
            url: LISTING_1,
            fields: { description: "detail" },
            media: [],
            raw: {},
          }
        : null,
  );
  try {
    const summary = await runCampaign(
      { store, browser, search: new FakeSearch([SEARCH_URL]), visitDetails: true, detailLimit: 10 },
      {
        brief: makeBrief({
          budgets: { maxListings: 1, maxUsd: 15, maxMinutes: 5, visionMax: 5 },
        }),
        pack: propertyPack,
      },
    );
    assert.equal(summary.stopReason, "budget");
    assert.equal(summary.collected, 1);
    assert.equal(store.listListings().length, 1);
    assert.equal(browser.calls.filter((url) => url === LISTING_1).length, 1);
    const listing = store.findListing("trademe", "1")!;
    assert.equal(
      store.latestEvidence(listing.id).get("description")?.value,
      "detail",
    );
  } finally {
    store.close();
  }
});

test("emits progress and log events for monitoring", async () => {
  const store = CampaignStore.open(":memory:");
  const browser = new FakeBrowser((url) => {
    if (url === SEARCH_URL) return [item("1", LISTING_1, 600)];
    throw new Error("blocked");
  });
  const events: RunnerEvent[] = [];
  try {
    await runCampaign(
      {
        store,
        browser,
        search: new FakeSearch([SEARCH_URL]),
        visitDetails: true,
        detailLimit: 1,
        onEvent: (event) => events.push(event),
      },
      { brief: makeBrief(), pack: propertyPack },
    );

    assert.ok(
      events.some((event) => event.type === "progress" && event.stage === "discover"),
    );
    assert.ok(
      events.some((event) => event.type === "progress" && event.stage === "collect"),
    );
    assert.ok(
      events.some((event) => event.type === "log" && event.level === "info"),
    );
    assert.ok(
      events.some(
        (event) =>
          event.type === "log" &&
          event.level === "error" &&
          event.message.includes("blocked"),
      ),
    );
  } finally {
    store.close();
  }
});

test("source policy excludes denied sites from discovery", async () => {
  const store = CampaignStore.open(":memory:");
  const browser = new FakeBrowser(() => null);
  try {
    const summary = await runCampaign(
      {
        store,
        browser,
        search: new FakeSearch([LISTING_1]),
        visitDetails: false,
      },
      {
        brief: makeBrief({
          sources: { web: "open", deny: ["trademe"] },
        }),
        pack: propertyPack,
      },
    );

    assert.equal(summary.discovered, 0);
    assert.equal(summary.collected, 0);
    assert.equal(store.listListings().length, 0);
  } finally {
    store.close();
  }
});
