import assert from "node:assert/strict";
import { test } from "node:test";
import { briefFromExtraction } from "../src/brief/brief.ts";
import {
  bareHost,
  ResponsesQueryPlanner,
  validatePlannedQueries,
} from "../src/discovery/planner.ts";
import { listRecipes } from "../src/sources/index.ts";
import type { ResponsesClient } from "../src/vision/responses.ts";

test("bare hosts drop protocol, www, paths, and ports", () => {
  assert.equal(bareHost("https://www.trademe.co.nz/computers"), "trademe.co.nz");
  assert.equal(bareHost("HTTP://Example.COM:8080/a/b"), "example.com");
  assert.equal(bareHost("trademe.co.nz"), "trademe.co.nz");
});

test("planned queries are cleaned, deduped, and host-checked", () => {
  const planned = validatePlannedQueries(
    {
      queries: [
        { query: "  m2   macbook  auckland ", site: "https://www.trademe.co.nz/computers" },
        { query: "m2 macbook auckland", site: "trademe.co.nz" },
        { query: "site:example.com m2 macbook", site: null },
        { query: "{prompt}", site: null },
        { query: "x", site: null },
      ],
    },
    ["trademe.co.nz"],
  );

  assert.deepEqual(planned, [
    { query: "m2 macbook auckland", site: "trademe.co.nz" },
    { query: "m2 macbook" },
  ]);
});

test("an unknown host is dropped but the query survives", () => {
  const planned = validatePlannedQueries(
    { queries: [{ query: "m2 macbook auckland", site: "example.com" }] },
    ["trademe.co.nz"],
  );
  assert.deepEqual(planned, [{ query: "m2 macbook auckland" }]);
});

test("the planner sends the prompt, criteria, and sources", async () => {
  let captured: { schema?: unknown; input?: unknown } = {};
  const client = {
    async structured(request: {
      schema?: unknown;
      input?: unknown;
    }) {
      captured = request;
      return {
        data: {
          queries: [{ query: "m2 macbook air auckland", site: "trademe.co.nz" }],
        },
      };
    },
  } as unknown as ResponsesClient;

  const brief = briefFromExtraction(
    "used M2 MacBook Air with 16GB in Auckland",
    {
      criteria: [
        {
          key: "ram_gb",
          label: "RAM",
          weight: 1,
          kind: "number",
          normalizer: { type: "higher-is-better", max: 64 },
          source: { type: "field", field: "ram_gb" },
          origin: "explicit",
          hard: { op: "gte", value: 16 },
        },
      ],
    },
  );

  const planner = new ResponsesQueryPlanner(client, "model");
  const planned = await planner.plan({ brief, sources: listRecipes() });

  assert.deepEqual(planned, [
    { query: "m2 macbook air auckland", site: "trademe.co.nz" },
  ]);
  const input = JSON.stringify(captured.input);
  assert.match(input, /16GB/);
  assert.match(input, /Trade Me/);
});

test("invalid planner output yields no queries", () => {
  assert.deepEqual(validatePlannedQueries({ queries: "nope" }, []), []);
  assert.deepEqual(validatePlannedQueries({ queries: [] }, []), []);
});
