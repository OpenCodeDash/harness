import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getRecipeFor,
  listRecipes,
  RecipeError,
  registerRecipe,
  runListing,
  runSearch,
  type Recipe,
  type RecipePage,
} from "../src/sources/recipe.ts";
import {
  parseEvaluateResult,
  parseSelectedPageId,
} from "../src/browser/mcp.ts";

class FakePage implements RecipePage {
  waits: string[] = [];
  constructor(
    private readonly searchResult: unknown,
    private readonly listingResult: unknown = null,
  ) {}
  async waitFor(script: string): Promise<void> {
    this.waits.push(script);
  }
  async evaluate<T>(script: string): Promise<T> {
    return (script === "search" ? this.searchResult : this.listingResult) as T;
  }
}

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: `test-${Math.random().toString(36).slice(2)}`,
    domain: "property",
    version: 1,
    matches: (url) => url.includes("example.test"),
    isListing: (url) => url.includes("/listing/"),
    searchReady: "search-ready",
    listingReady: "listing-ready",
    searchScript: "search",
    listingScript: "listing",
    ...overrides,
  };
}

test("runSearch validates, resolves URLs, filters media, and dedupes", async () => {
  const page = new FakePage([
    {
      externalId: 1,
      url: "/listing/1",
      fields: { rent: 600 },
      media: ["/a.jpg", 42],
    },
    { externalId: "1", url: "/listing/1", fields: {} },
    { externalId: "2", url: "https://example.test/listing/2", media: [] },
  ]);
  const r = recipe();
  const results = await runSearch(page, r, "https://example.test/search");

  assert.deepEqual(page.waits, ["search-ready"]);
  assert.equal(results.length, 2);
  assert.equal(results[0]?.url, "https://example.test/listing/1");
  assert.deepEqual(results[0]?.media, ["https://example.test/a.jpg"]);
  assert.equal(results[0]?.source, r.id);
});

test("runListing forces the requested URL and waits for readiness", async () => {
  const page = new FakePage(null, {
    externalId: "3",
    url: "/listing/3",
    fields: { description: "hello" },
  });
  const result = await runListing(
    page,
    recipe(),
    "https://example.test/listing/3",
  );
  assert.equal(result.url, "https://example.test/listing/3");
  assert.equal(result.fields.description, "hello");
  assert.deepEqual(page.waits, ["listing-ready"]);
});

test("invalid recipe output fails loudly", async () => {
  await assert.rejects(
    () => runSearch(new FakePage({ not: "an array" }), recipe(), "https://x.test"),
    RecipeError,
  );
  await assert.rejects(
    () =>
      runSearch(new FakePage([{ url: "/x" }]), recipe(), "https://x.test"),
    /missing externalId/,
  );
  await assert.rejects(
    () =>
      runSearch(
        new FakePage([{ externalId: "1" }]),
        recipe(),
        "https://x.test",
      ),
    /missing or invalid url/,
  );
});

test("registry matches by URL and replaces duplicate ids", () => {
  const r = recipe({ id: "registry-test", matches: (url) => url.includes("reg.test") });
  registerRecipe(r);
  assert.equal(getRecipeFor("https://reg.test/a")?.id, "registry-test");
  assert.equal(getRecipeFor("https://other.test/a"), null);

  const replacement = { ...r, version: 2 };
  registerRecipe(replacement);
  assert.equal(getRecipeFor("https://reg.test/a")?.version, 2);
  assert.equal(
    listRecipes().filter((item) => item.id === "registry-test").length,
    1,
  );
});

test("parses the browser evaluate wrapper and selected page ids", () => {
  const text = [
    "Script ran on page and returned:",
    "```json",
    JSON.stringify(JSON.stringify({ count: 23 })),
    "```",
  ].join("\n");
  assert.deepEqual(parseEvaluateResult(text), { count: 23 });
  assert.equal(parseEvaluateResult("plain"), "plain");

  const pages = "## Pages\n1: about:blank\n2: https://x.test [selected]\n";
  assert.equal(parseSelectedPageId(pages), 2);
  assert.equal(parseSelectedPageId("1: a\n2: b\n"), 2);
});
