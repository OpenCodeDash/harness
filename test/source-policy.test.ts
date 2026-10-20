import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SOURCE_SCOPE,
  type SourceScope,
} from "../src/brief/types.ts";
import {
  isUrlAllowed,
  jsonLdRecipe,
  listRecipes,
  selectSources,
  trademeRecipe,
} from "../src/sources/index.ts";
import type { DiscoverySource } from "../src/sources/discovery.ts";

const htmlSource: DiscoverySource = {
  id: "html",
  discovery: { label: "Generic HTML", kind: "html" },
};

const scope = (overrides: Partial<SourceScope> = {}): SourceScope => ({
  ...DEFAULT_SOURCE_SCOPE,
  ...overrides,
});

test("open web activates every source and prefers without restricting", () => {
  const selection = selectSources(listRecipes(), scope());
  assert.deepEqual(
    selection.active.map((source) => source.id),
    ["trademe", "jsonld"],
  );
  assert.equal(selection.skipped.length, 0);

  const preferred = selectSources(listRecipes(), scope({ prefer: ["jsonld"] }));
  assert.deepEqual(
    preferred.active.map((source) => source.id),
    ["jsonld", "trademe"],
  );
});

test("allow and deny filter by source id or host", () => {
  const allowSource = selectSources(
    listRecipes(),
    scope({ allow: ["trademe"] }),
  );
  assert.deepEqual(
    allowSource.active.map((source) => source.id),
    ["trademe"],
  );
  assert.ok(
    allowSource.skipped.some(
      (entry) => entry.id === "jsonld" && entry.reason === "not allowed",
    ),
  );

  const allowHost = selectSources(
    listRecipes(),
    scope({ allow: ["trademe.co.nz"] }),
  );
  assert.deepEqual(
    allowHost.active.map((source) => source.id),
    ["trademe"],
  );

  const denyHost = selectSources(
    listRecipes(),
    scope({ deny: ["trademe.co.nz"] }),
  );
  assert.deepEqual(
    denyHost.active.map((source) => source.id),
    ["jsonld"],
  );
  assert.ok(
    denyHost.skipped.some(
      (entry) => entry.id === "trademe" && entry.reason === "denied",
    ),
  );
});

test("web off only allows explicitly allowed sources", () => {
  const none = selectSources(listRecipes(), scope({ web: "off" }));
  assert.equal(none.active.length, 0);
  assert.equal(none.skipped.length, listRecipes().length);

  const allowed = selectSources(
    listRecipes(),
    scope({ web: "off", allow: ["trademe"] }),
  );
  assert.deepEqual(
    allowed.active.map((source) => source.id),
    ["trademe"],
  );
});

test("structured-only skips generic HTML sources", () => {
  const selection = selectSources(
    [trademeRecipe, jsonLdRecipe, htmlSource],
    scope({ web: "structured-only" }),
  );
  assert.deepEqual(
    selection.active.map((source) => source.id),
    ["trademe", "jsonld"],
  );
  assert.ok(
    selection.skipped.some(
      (entry) => entry.id === "html" && entry.reason === "structured sources only",
    ),
  );
});

test("unknown allow and deny entries warn instead of failing", () => {
  const selection = selectSources(
    listRecipes(),
    scope({ allow: ["trademe", "spaceships"], deny: ["myspace"] }),
  );
  assert.ok(
    selection.warnings.some((warning) => warning.includes("spaceships")),
  );
  assert.ok(selection.warnings.some((warning) => warning.includes("myspace")));
});

test("URL policy honours host allow, deny, web mode, and extraction kind", () => {
  const sources = listRecipes();
  const trademeMotors = "https://www.trademe.co.nz/a/motors/listing/1";
  const external = "https://shop.test/product/1";

  assert.equal(isUrlAllowed(trademeMotors, scope(), sources, "trademe"), true);
  assert.equal(isUrlAllowed(external, scope(), sources, "jsonld"), true);

  assert.equal(
    isUrlAllowed(trademeMotors, scope({ allow: ["trademe"] }), sources, "jsonld"),
    true,
  );
  assert.equal(
    isUrlAllowed(external, scope({ allow: ["trademe"] }), sources, "jsonld"),
    false,
  );
  assert.equal(
    isUrlAllowed(trademeMotors, scope({ deny: ["trademe"] }), sources, "jsonld"),
    false,
  );
  assert.equal(
    isUrlAllowed(trademeMotors, scope({ deny: ["jsonld"] }), sources, "trademe"),
    true,
  );
  assert.equal(
    isUrlAllowed(external, scope({ deny: ["jsonld"] }), sources, "jsonld"),
    false,
  );
  assert.equal(
    isUrlAllowed(external, scope({ web: "off", allow: ["trademe"] }), sources, "jsonld"),
    false,
  );
  assert.equal(
    isUrlAllowed(external, scope({ web: "off" }), sources, "jsonld"),
    false,
  );
  assert.equal(
    isUrlAllowed(
      external,
      scope({ web: "structured-only" }),
      [htmlSource, ...sources],
      "html",
    ),
    false,
  );
});
