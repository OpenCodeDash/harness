import assert from "node:assert/strict";
import { test } from "node:test";
import { VERSION } from "../src/version.ts";

test("scaffold runs", () => {
  assert.equal(VERSION, "0.1.0");
});
