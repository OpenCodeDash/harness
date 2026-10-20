import assert from "node:assert/strict";
import { test } from "node:test";
import { briefFromExtraction } from "../src/brief/brief.ts";
import {
  buildDiscoveryQueries,
  renderTemplate,
} from "../src/discovery/queries.ts";
import {
  canonicalUrl,
  parseSearchResults,
  SearxngMcpProvider,
} from "../src/discovery/searxng.ts";
import { propertyPack } from "../src/domain/property.ts";

test("renders templates and collapses empty placeholders", () => {
  assert.equal(
    renderTemplate("{bedrooms} bedroom for rent {area}", {
      area: "Petone",
      bedrooms: "2-3",
      rent: "",
      property_type: "",
    }),
    "2-3 bedroom for rent Petone",
  );
  assert.equal(
    renderTemplate("rental {area} {rent}", {
      area: "Wellington",
      bedrooms: "",
      rent: "",
      property_type: "",
    }),
    "rental Wellington",
  );
});

test("builds one query set per area without duplicates", () => {
  const brief = briefFromExtraction("rental", propertyPack, {
    hard: {
      rent_max: 650,
      bedrooms: { min: 2, max: 3 },
      areas: ["Wellington", "Petone"],
      required: { property_type: "townhouse" },
    },
  });
  const queries = buildDiscoveryQueries(brief, propertyPack);

  assert.ok(queries.some((q) => q.includes("Wellington")));
  assert.ok(queries.some((q) => q.includes("Petone")));
  assert.ok(queries.some((q) => q.includes("site:trademe.co.nz")));
  assert.ok(queries.some((q) => q.includes("under 650")));
  assert.equal(new Set(queries).size, queries.length);
  assert.ok(queries.every((q) => !q.includes("{")));
});

test("canonical URLs drop tracking params, fragments, and trailing slashes", () => {
  assert.equal(
    canonicalUrl(
      "https://WWW.TradeMe.co.nz/a/property/rent/wellington/?utm_source=x&srsltid=abc#top",
    ),
    "https://www.trademe.co.nz/a/property/rent/wellington",
  );
  assert.equal(canonicalUrl("not a url"), "not a url");
});

test("parses object, array, and structured results", () => {
  const object = {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          results: [
            { title: "A", url: "https://a.test/1?utm_source=x", content: "aaa" },
            { title: "B", url: "https://b.test/2", snippet: "bbb" },
          ],
        }),
      },
    ],
  };
  assert.deepEqual(parseSearchResults(object), [
    { title: "A", url: "https://a.test/1", snippet: "aaa" },
    { title: "B", url: "https://b.test/2", snippet: "bbb" },
  ]);

  assert.deepEqual(
    parseSearchResults({
      content: [
        {
          type: "text",
          text: JSON.stringify([{ title: "C", url: "https://c.test", content: "c" }]),
        },
      ],
    }),
    [{ title: "C", url: "https://c.test", snippet: "c" }],
  );

  assert.deepEqual(
    parseSearchResults({
      structuredContent: {
        results: [{ title: "D", url: "https://d.test", content: "d" }],
      },
    }),
    [{ title: "D", url: "https://d.test", snippet: "d" }],
  );
});

test("errors and malformed payloads are handled", () => {
  assert.throws(
    () =>
      parseSearchResults({
        isError: true,
        content: [{ type: "text", text: "rate limited" }],
      }),
    /rate limited/,
  );
  assert.deepEqual(parseSearchResults({ content: [{ type: "text", text: "nope" }] }), []);
  assert.deepEqual(parseSearchResults({ content: [] }), []);
});

test("provider sends the expected MCP arguments and dedupes", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const provider = new SearxngMcpProvider(async (name, args) => {
    calls.push({ name, args });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            results: [
              { title: "A", url: "https://a.test/1", content: "a" },
              { title: "A again", url: "https://a.test/1?utm_source=x", content: "a" },
            ],
          }),
        },
      ],
    };
  });

  const results = await provider.search("wellington rental", { limit: 2 });
  assert.equal(calls[0]?.name, "searxng_web_search");
  assert.equal(calls[0]?.args.query, "wellington rental");
  assert.equal(calls[0]?.args.num_results, 2);
  assert.equal(calls[0]?.args.response_format, "json");
  assert.equal(results.length, 1);
});
