import assert from "node:assert/strict";
import { test } from "node:test";
import { CampaignStore } from "../src/campaign/store.ts";
import {
  MemoryGeoCache,
  NominatimGeocoder,
  OpenRouteServiceRouter,
  OsrmRouter,
} from "../src/geo/providers.ts";
import { CachedGeoService } from "../src/geo/service.ts";
import type { GeoPoint, GeocodeProvider } from "../src/geo/types.ts";

test("Nominatim geocoder sends a user agent and parses coordinates", async () => {
  let captured: { url: string; init?: RequestInit } | null = null;
  const geocoder = new NominatimGeocoder({
    minIntervalMs: 0,
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify([{ lat: "-41.28", lon: "174.77" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const point = await geocoder.geocode("1 Lambton Quay, Wellington");
  assert.deepEqual(point, { lat: -41.28, lon: 174.77 });
  assert.match(captured!.url, /nominatim\.openstreetmap\.org\/search/);
  assert.match(captured!.url, /q=1%20Lambton%20Quay/);
  const headers = captured!.init?.headers as Record<string, string>;
  assert.match(headers["user-agent"] ?? "", /harness/);
});

test("Nominatim returns null when there is no match", async () => {
  const geocoder = new NominatimGeocoder({
    minIntervalMs: 0,
    fetchImpl: async () =>
      new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.equal(await geocoder.geocode("nowhere"), null);
});

test("ORS router posts a matrix request and converts seconds to minutes", async () => {
  let body: unknown = null;
  let auth: string | null = null;
  const router = new OpenRouteServiceRouter({
    apiKey: "key",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      auth = (init?.headers as Record<string, string>)?.authorization ?? null;
      return new Response(
        JSON.stringify({ durations: [[0, 600], [600, 0]] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const minutes = await router.driveMinutes(
    { lat: -41.28, lon: 174.77 },
    { lat: -41.22, lon: 174.8 },
  );
  assert.equal(minutes, 10);
  assert.equal(auth, "key");
  assert.deepEqual((body as { locations: number[][] }).locations, [
    [174.77, -41.28],
    [174.8, -41.22],
  ]);
});

test("geo service caches geocodes and routes, and expires them", async () => {
  let now = Date.now();
  let geocodeCalls = 0;
  let routeCalls = 0;
  const geocoder: GeocodeProvider = {
    async geocode() {
      geocodeCalls += 1;
      return { lat: -41.3, lon: 174.8 };
    },
  };
  const service = new CachedGeoService({
    geocoder,
    router: {
      async driveMinutes() {
        routeCalls += 1;
        return 12.5;
      },
    },
    cache: new MemoryGeoCache(),
    geocodeTtlMs: 1_000,
    routeTtlMs: 1_000,
    now: () => now,
  });

  const work: GeoPoint = { lat: -41.28, lon: 174.77 };
  assert.deepEqual(await service.geocode("1 Test St"), { lat: -41.3, lon: 174.8 });
  assert.deepEqual(await service.geocode("  1 test  st "), { lat: -41.3, lon: 174.8 });
  assert.equal(geocodeCalls, 1);

  assert.equal(await service.driveMinutes({ lat: -41.3, lon: 174.8 }, work), 12.5);
  assert.equal(await service.driveMinutes({ lat: -41.3, lon: 174.8 }, work), 12.5);
  assert.equal(routeCalls, 1);

  now += 2_000;
  await service.geocode("1 Test St");
  await service.driveMinutes({ lat: -41.3, lon: 174.8 }, work);
  assert.equal(geocodeCalls, 2);
  assert.equal(routeCalls, 2);
});

test("route failures become unknown instead of a guess", async () => {
  const service = new CachedGeoService({
    geocoder: { async geocode() { return { lat: 0, lon: 0 }; } },
    router: {
      async driveMinutes() {
        throw new Error("upstream down");
      },
    },
    cache: new MemoryGeoCache(),
  });
  assert.equal(
    await service.driveMinutes({ lat: 0, lon: 0 }, { lat: 1, lon: 1 }),
    null,
  );
  assert.equal(await service.commuteMinutes("x", { lat: 1, lon: 1 }), null);
});

test("store persists geocode and route cache entries", () => {
  const store = CampaignStore.open(":memory:");
  try {
    store.setGeoCache("geocode:x", { lat: 1, lon: 2 });
    assert.deepEqual(store.getGeoCache("geocode:x")?.value, { lat: 1, lon: 2 });
    assert.equal(store.getGeoCache("missing"), null);
  } finally {
    store.close();
  }
});

test("OSRM router requests a route and converts seconds to minutes", async () => {
  let url = "";
  const router = new OsrmRouter({
    baseUrl: "https://osrm.test",
    fetchImpl: async (input) => {
      url = String(input);
      return new Response(
        JSON.stringify({ routes: [{ duration: 725 }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  const minutes = await router.driveMinutes(
    { lat: -41.28, lon: 174.77 },
    { lat: -41.22, lon: 174.8 },
  );
  assert.equal(minutes, 12.1);
  assert.match(url, /^https:\/\/osrm\.test\/route\/v1\/driving\/174\.77,-41\.28;174\.8,-41\.22/);
});

test("route failures can be observed without guessing a value", async () => {
  const seen: unknown[] = [];
  const service = new CachedGeoService({
    geocoder: { async geocode() { return { lat: 0, lon: 0 }; } },
    router: {
      async driveMinutes() {
        throw new Error("429");
      },
    },
    cache: new MemoryGeoCache(),
  });
  assert.equal(
    await service.commuteMinutes("x", { lat: 1, lon: 1 }, (error) =>
      seen.push(error),
    ),
    null,
  );
  assert.equal(seen.length, 1);
  assert.match(String(seen[0]), /429/);
});

test("OSRM falls back to the next endpoint", async () => {
  const seen: string[] = [];
  const router = new OsrmRouter({
    baseUrls: ["https://down.test", "https://up.test"],
    fetchImpl: async (input) => {
      seen.push(String(input));
      if (String(input).includes("down.test")) throw new Error("fetch failed");
      return new Response(JSON.stringify({ routes: [{ duration: 600 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const minutes = await router.driveMinutes(
    { lat: -41.28, lon: 174.77 },
    { lat: -41.22, lon: 174.8 },
  );
  assert.equal(minutes, 10);
  assert.equal(seen.length, 2);
});

test("geocoder falls back to Photon when Nominatim only returns a street", async () => {
  const calls: string[] = [];
  const geocoder = new NominatimGeocoder({
    minIntervalMs: 0,
    fetchImpl: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("nominatim")) {
        return new Response(
          JSON.stringify([
            {
              lat: "-36.9081",
              lon: "174.7355",
              display_name: "Stoddard Road, Mount Roskill, Auckland",
              addresstype: "road",
              type: "secondary",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          features: [
            {
              properties: {
                housenumber: "64c",
                street: "Stoddard Road",
                type: "house",
              },
              geometry: { coordinates: [174.7298642, -36.9062905] },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const point = await geocoder.geocode("64C Stoddard Road, Mount Roskill");
  assert.deepEqual(point, { lat: -36.9062905, lon: 174.7298642 });
  assert.ok(calls.some((url) => url.includes("photon.komoot.io")));
});

test("OSRM driveRoute returns both duration and distance", async () => {
  const router = new OsrmRouter({
    baseUrl: "https://osrm.test",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          routes: [{ duration: 600, distance: 6268.1 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  const route = await router.driveRoute(
    { lat: -41.28, lon: 174.77 },
    { lat: -41.22, lon: 174.8 },
  );
  assert.equal(route.minutes, 10);
  assert.equal(route.distanceKm, 6.27);
});
