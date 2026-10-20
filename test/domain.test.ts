import assert from "node:assert/strict";
import { test } from "node:test";
import { getPack, listPacks } from "../src/domain/index.ts";
import { propertyPack } from "../src/domain/property.ts";
import { findField, findImageFeature } from "../src/domain/types.ts";

test("packs are available and discoverable", () => {
  assert.equal(getPack("property"), propertyPack);
  assert.deepEqual(
    listPacks().map((pack) => pack.id),
    ["property", "cars", "laptops"],
  );
});

test("unknown packs fail loudly", () => {
  assert.throws(() => getPack("spaceships"), /Unknown domain pack/);
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

test("query templates only use known placeholders", () => {
  const known = new Set([
    "area",
    "prompt",
    "keywords",
    "bedrooms",
    "rent",
    "price",
    "property_type",
  ]);
  for (const pack of listPacks()) {
    for (const field of pack.fields) known.add(field.key);
    for (const raw of pack.queryTemplates) {
      const template = typeof raw === "string" ? raw : raw.template;
      for (const match of template.matchAll(/\{(\w+)\}/g)) {
        assert.ok(known.has(match[1]!), `${pack.id}: unknown placeholder {${match[1]}}`);
      }
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
