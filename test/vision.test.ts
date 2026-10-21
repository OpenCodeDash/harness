import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cacheImage, hashBuffer } from "../src/vision/media.ts";
import { ResponsesClient } from "../src/vision/responses.ts";
import {
  buildVisionPrompt,
  buildVisionSchema,
  extractFactsFromBuffer,
  probeVision,
} from "../src/vision/vision.ts";

const IMAGE_FEATURES = [
  {
    key: "heat_pump",
    label: "Heat pump",
    prompt: "Is a heat pump visible?",
    kind: "boolean" as const,
  },
  {
    key: "sunlight",
    label: "Sunlight",
    prompt: "How much direct sunlight is visible?",
    kind: "enum" as const,
    options: ["low", "medium", "high"],
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Responses client posts a JSON schema request and parses output", async () => {
  let captured: { url: string; init?: RequestInit } | null = null;
  const client = new ResponsesClient({
    baseUrl: "http://router.test/v1",
    apiKey: "secret",
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init };
      return jsonResponse({
        output: [
          {
            type: "reasoning",
            content: [{ type: "output_text", text: "ignored" }],
          },
          {
            type: "message",
            content: [{ type: "output_text", text: '{"ok":true}' }],
          },
        ],
        usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
      });
    },
  });

  const result = await client.structured<{ ok: boolean }>({
    model: "opencode-go-gpt-5.6-luna",
    input: [{ role: "user", content: [] }],
    schema: { type: "object", properties: { ok: { type: "boolean" } } },
    name: "probe",
  });

  assert.equal(result.data.ok, true);
  assert.equal(result.usage?.total_tokens, 7);
  assert.equal(captured!.url, "http://router.test/v1/responses");
  const headers = captured!.init?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer secret");
  const body = JSON.parse(String(captured!.init?.body));
  assert.equal(body.model, "opencode-go-gpt-5.6-luna");
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.name, "probe");
});

test("Responses client fails loudly on HTTP and malformed output", async () => {
  const errorClient = new ResponsesClient({
    baseUrl: "http://router.test/v1",
    fetchImpl: async () => new Response("nope", { status: 400 }),
  });
  await assert.rejects(
    () =>
      errorClient.structured({
        model: "m",
        input: [],
        schema: {},
        name: "x",
      }),
    /Responses API 400/,
  );

  const emptyClient = new ResponsesClient({
    baseUrl: "http://router.test/v1",
    fetchImpl: async () => jsonResponse({ output: [] }),
  });
  await assert.rejects(
    () =>
      emptyClient.structured({ model: "m", input: [], schema: {}, name: "x" }),
    /no output text/,
  );

  const badJsonClient = new ResponsesClient({
    baseUrl: "http://router.test/v1",
    fetchImpl: async () =>
      jsonResponse({
        output: [{ type: "message", content: [{ type: "output_text", text: "not json" }] }],
      }),
  });
  await assert.rejects(
    () =>
      badJsonClient.structured({ model: "m", input: [], schema: {}, name: "x" }),
    /invalid JSON/,
  );
});

test("vision schema and prompt cover the requested features", () => {
  const schema = buildVisionSchema(IMAGE_FEATURES) as {
    properties: { features: { properties: Record<string, unknown> } };
  };
  assert.ok(schema.properties.features.properties.heat_pump);
  assert.ok(schema.properties.features.properties.sunlight);
  assert.match(buildVisionPrompt(IMAGE_FEATURES), /heat_pump \(boolean\)/);
  assert.match(buildVisionPrompt(IMAGE_FEATURES), /one of low, medium, high/);
});

test("image extraction produces provenance-tagged facts and skips nulls", async () => {
  const buffer = Buffer.from([1, 2, 3, 4]);
  const hash = `sha256:${hashBuffer(buffer)}`;
  const client = {
    async structured() {
      return {
        data: {
          features: {
            heat_pump: { value: true, confidence: 1.4 },
            sunlight: { value: null, confidence: 0.9 },
          },
        },
        usage: { total_tokens: 10 },
      };
    },
  } as unknown as ResponsesClient;

  const result = await extractFactsFromBuffer(client, {
    buffer,
    mimeType: "image/png",
    features: IMAGE_FEATURES,
    model: "m",
  });

  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0]?.key, "heat_pump");
  assert.equal(result.facts[0]?.value, true);
  assert.equal(result.facts[0]?.confidence, 1);
  assert.equal(result.facts[0]?.sourceRef, hash);
});

test("vision probe fails when the model cannot see the image", async () => {
  const ok = {
    async structured() {
      return { data: { ok: true } };
    },
  } as unknown as ResponsesClient;
  await probeVision(ok, "m");

  const broken = {
    async structured() {
      return { data: { ok: false } };
    },
  } as unknown as ResponsesClient;
  await assert.rejects(() => probeVision(broken, "m"), /ok=false/);
});

test("media cache writes hashed files and rejects non-images", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-media-"));
  try {
    const bytes = Buffer.from([9, 8, 7]);
    const cached = await cacheImage({
      url: "https://cdn.test/a.png",
      dir,
      resolve: async () => ["93.184.216.34"],
      fetchImpl: async () =>
        new Response(bytes, {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    });
    assert.equal(cached.hash, hashBuffer(bytes));
    assert.equal(cached.mimeType, "image/png");
    assert.deepEqual(readFileSync(cached.path), bytes);
    assert.match(cached.path, /\.png$/);

    await assert.rejects(
      () =>
        cacheImage({
          url: "https://cdn.test/a.html",
          dir,
          resolve: async () => ["93.184.216.34"],
          fetchImpl: async () =>
            new Response("html", {
              status: 200,
              headers: { "content-type": "text/html" },
            }),
        }),
      /not an image/,
    );

    await assert.rejects(
      () =>
        cacheImage({
          url: "https://cdn.test/big.png",
          dir,
          resolve: async () => ["93.184.216.34"],
          maxBytes: 2,
          fetchImpl: async () =>
            new Response(Buffer.from([1, 2, 3]), {
              status: 200,
              headers: { "content-type": "image/png" },
            }),
        }),
      /too large/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("media cache refuses private hosts before fetching", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-media-"));
  let called = false;
  try {
    await assert.rejects(
      () =>
        cacheImage({
          url: "http://127.0.0.1/internal.png",
          dir,
          fetchImpl: async () => {
            called = true;
            return new Response(Buffer.from([1]), { status: 200 });
          },
        }),
      /blocked/,
    );
    assert.equal(called, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
