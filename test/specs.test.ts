import assert from "node:assert/strict";
import { test } from "node:test";
import {
  flattenSpecs,
  normaliseSpecKey,
  parseTextSpecs,
  resolveSpecKey,
} from "../src/domain/specs.ts";

test("spec keys are normalised", () => {
  assert.equal(normaliseSpecKey(" RAM Size "), "ram_size");
  assert.equal(normaliseSpecKey("Battery-health %"), "battery_health");
});

test("field keys resolve through unit aliases", () => {
  assert.equal(resolveSpecKey("ram_gb", ["memory"]), "memory");
  assert.equal(resolveSpecKey("ram_gb", ["ram_size"]), "ram_size");
  assert.equal(
    resolveSpecKey("storage_gb", ["hard_drive_size"]),
    "hard_drive_size",
  );
  assert.equal(
    resolveSpecKey("battery_health", ["maximum_capacity"]),
    "maximum_capacity",
  );
});

test("exact and fuzzy matches work without aliases", () => {
  assert.equal(resolveSpecKey("screen_size", ["screen_size"]), "screen_size");
  assert.equal(resolveSpecKey("screen_size", ["display_size"]), "display_size");
  assert.equal(resolveSpecKey("colour", ["colour"]), "colour");
  assert.equal(resolveSpecKey("ram_gb", ["brand"]), null);
});

test("specs flatten to normalised evidence keys", () => {
  assert.deepEqual(
    flattenSpecs({ "RAM Size": "16GB", Brand: "Apple", empty: "" }),
    { ram_size: "16GB", brand: "Apple" },
  );
  assert.deepEqual(flattenSpecs(null), {});
});

test("parses capacities, battery, and year from free text", () => {
  assert.deepEqual(
    parseTextSpecs("Apple MacBook Air M2 8GB 256GB SSD"),
    { ram_gb: 8, storage_gb: 256 },
  );
  assert.deepEqual(
    parseTextSpecs("MacBook Pro 16GB RAM 512GB SSD, battery health 93%"),
    { ram_gb: 16, storage_gb: 512, battery_health: 93 },
  );
  assert.deepEqual(parseTextSpecs("2023 M2 Pro 32GB + 1TB"), {
    ram_gb: 32,
    storage_gb: 1024,
    year: 2023,
  });
});
