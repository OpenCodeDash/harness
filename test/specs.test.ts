import assert from "node:assert/strict";
import { test } from "node:test";
import {
  flattenSpecs,
  normaliseSpecKey,
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
