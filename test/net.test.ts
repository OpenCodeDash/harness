import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSafeHttpUrl } from "../src/util/net.ts";

const publicResolve = async () => ["93.184.216.34"];

test("allows public http and https URLs", async () => {
  await assert.doesNotReject(() =>
    assertSafeHttpUrl("https://cdn.example.com/a.jpg", { resolve: publicResolve }),
  );
  await assert.doesNotReject(() =>
    assertSafeHttpUrl("http://example.com/a.jpg", { resolve: publicResolve }),
  );
});

test("blocks loopback, private, link-local, and metadata addresses", async () => {
  await assert.rejects(() => assertSafeHttpUrl("http://127.0.0.1/x"), /blocked/);
  await assert.rejects(() => assertSafeHttpUrl("http://localhost/x"), /blocked host/);
  await assert.rejects(() => assertSafeHttpUrl("http://10.0.0.5/x"), /blocked private/);
  await assert.rejects(() => assertSafeHttpUrl("http://172.16.0.1/x"), /blocked private/);
  await assert.rejects(() => assertSafeHttpUrl("http://192.168.1.5/x"), /blocked private/);
  await assert.rejects(
    () => assertSafeHttpUrl("http://169.254.169.254/latest/meta-data"),
    /blocked private/,
  );
  await assert.rejects(() => assertSafeHttpUrl("http://[::1]/x"), /blocked private/);
});

test("blocks hostnames that resolve to private addresses", async () => {
  await assert.rejects(
    () =>
      assertSafeHttpUrl("http://rebind.test/x", {
        resolve: async () => ["127.0.0.1"],
      }),
    /blocked private/,
  );
});

test("rejects non-http protocols", async () => {
  await assert.rejects(
    () => assertSafeHttpUrl("file:///etc/passwd"),
    /unsupported protocol/,
  );
  await assert.rejects(
    () => assertSafeHttpUrl("data:image/png;base64,abc"),
    /unsupported protocol/,
  );
});

test("enforces an optional host allowlist", async () => {
  await assert.rejects(
    () =>
      assertSafeHttpUrl("https://evil.test/x", {
        allowedHosts: ["trademe.tmcdn.co.nz"],
        resolve: publicResolve,
      }),
    /host not allowed/,
  );
  await assert.doesNotReject(() =>
    assertSafeHttpUrl("https://trademe.tmcdn.co.nz/photoserver/full/1.jpg", {
      allowedHosts: ["trademe.tmcdn.co.nz"],
      resolve: publicResolve,
    }),
  );
  await assert.doesNotReject(() =>
    assertSafeHttpUrl("https://cdn.example.com/x.jpg", {
      allowedHosts: ["example.com"],
      resolve: publicResolve,
    }),
  );
});
