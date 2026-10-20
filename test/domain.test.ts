import assert from "node:assert/strict";
import { test } from "node:test";
import { findPack, getPack, listPacks } from "../src/domain/index.ts";
import { genericPack } from "../src/domain/generic.ts";
import { propertyPack } from "../src/domain/property.ts";
import { findField, findImageFeature } from "../src/domain/types.ts";

test("packs are available and discoverable", () => {
  assert.equal(getPack("property"), propertyPack);
  assert.equal(getPack("generic"), genericPack);
  assert.deepEqual(
    listPacks().map((pack) => pack.id),
    ["generic", "property", "cars", "laptops"],
  );
  assert.equal(findPack("property"), propertyPack);
});

test("unknown packs fall back to the generic vocabulary", () => {
  assert.equal(findPack("spaceships"), undefined);
  assert.equal(getPack("spaceships"), genericPack);
  assert.equal(getPack(), genericPack);
});

test("every default criterion points at a pack capability", () => {
  for (const pack of listPacks()) {
    for (const criterion of pack.defaultCriteria) {
      const source = criterion.source;
      if (source.type === "field") {
        assert.ok(
          findField(pack, source.field),
          `${pack.id}: no field "${source.field}" for "${criterion.key}"`,
        );
      } else if (source.type === "image") {
        assert.ok(
          source.prompt.length > 10,
          `${pack.id}: weak image prompt for "${criterion.key}"`,
        );
      } else if (source.type === "text") {
        assert.ok(
          source.prompt.length > 10,
          `${pack.id}: weak text prompt for "${criterion.key}"`,
        );
      } else {
        assert.ok(source.evaluator, `${pack.id}: missing evaluator`);
      }
    }
  }
});

test("criteria weights are in range and image features are promptable", () => {
  for (const pack of listPacks()) {
    for (const criterion of pack.defaultCriteria) {
      assert.ok(criterion.weight >= 0 && criterion.weight <= 1);
    }
    for (const feature of pack.imageFeatures) {
      assert.ok(
        feature.prompt.length > 10,
        `${pack.id}: weak prompt for "${feature.key}"`,
      );
    }
  }
});

test("enum normalizers cover their options", () => {
  for (const pack of listPacks()) {
    for (const criterion of pack.defaultCriteria) {
      if (criterion.normalizer.type !== "enum") continue;
      const feature = findImageFeature(pack, criterion.key);
      const field = findField(pack, criterion.key);
      const options = feature?.options ?? field?.options ?? [];
      for (const option of options) {
        assert.ok(
          criterion.normalizer.scores[option] !== undefined,
          `missing score for "${pack.id}.${criterion.key}.${option}"`,
        );
      }
    }
  }
});
