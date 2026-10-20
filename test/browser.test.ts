import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultBrowserConfig,
  findChrome,
  parseEvaluateResult,
  parseSelectedPageId,
} from "../src/browser/mcp.ts";

test("browser defaults are headless and isolated for server deployment", () => {
  const config = defaultBrowserConfig();
  assert.equal(config.command, "npx");
  assert.ok(config.args.includes("--headless"));
  assert.ok(config.args.includes("--isolated"));
  assert.ok(config.args.includes("--no-usage-statistics"));
  assert.ok(config.args.some((arg) => arg.startsWith("--executablePath=")));
  assert.equal(typeof findChrome(), "string");
});

test("HARNESS_HEADLESS=0 opts out of headless", () => {
  const previous = process.env.HARNESS_HEADLESS;
  process.env.HARNESS_HEADLESS = "0";
  try {
    assert.equal(defaultBrowserConfig().args.includes("--headless"), false);
  } finally {
    if (previous === undefined) delete process.env.HARNESS_HEADLESS;
    else process.env.HARNESS_HEADLESS = previous;
  }
});

test("browser response parsers handle SSE-ish payloads", () => {
  assert.deepEqual(
    parseEvaluateResult(
      'Script ran on page and returned:\n```json\n"{\\"count\\":2}"\n```',
    ),
    { count: 2 },
  );
  assert.equal(parseSelectedPageId("## Pages\n1: a\n2: b [selected]"), 2);
});
