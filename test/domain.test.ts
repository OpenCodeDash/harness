import assert from "node:assert/strict";
import { test } from "node:test";
import { getPack, listPacks } from "../src/domain/index.ts";
import { propertyPack } from "../src/domain/property.ts";
import { findField, findImageFeature } from "../src/domain/types.ts";

test("property pack is available and discoverable", () => {
  assert.equal(getPack("property"), propertyPack);
  assert.deepEqual(
    listPacks().map((pack) => pack.id),
    ["property"],
  );
});

test("unknown packs fail loudly", () => {
  assert.throws(() => getPack("spaceships"), /Unknown domain pack/);
});

test("every criterion has a field or image feature to supply it", () => {
  for (const criterion of propertyPack.defaultCriteria) {
    const source =
      findField(propertyPack, criterion.key) ??
      findImageFeature(propertyPack, criterion.key);
    assert.ok(source, `no source for criterion "${criterion.key}"`);
  }
});

test("criteria weights are in range and image features are promptable", () => {
  for (const criterion of propertyPack.defaultCriteria) {
    assert.ok(criterion.weight >= 0 && criterion.weight <= 1);
  }
  for (const feature of propertyPack.imageFeatures) {
    assert.ok(feature.prompt.length > 10, `weak prompt for "${feature.key}"`);
  }
});

test("enum normalizers cover their options", () => {
  for (const criterion of propertyPack.defaultCriteria) {
    if (criterion.normalizer.type !== "enum") continue;
    const feature = findImageFeature(propertyPack, criterion.key);
    const field = findField(propertyPack, criterion.key);
    const options = feature?.options ?? field?.options ?? [];
    for (const option of options) {
      assert.ok(
        criterion.normalizer.scores[option] !== undefined,
        `missing score for "${criterion.key}.${option}"`,
      );
    }
  }
});
