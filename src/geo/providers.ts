import type {
  GeoCache,
  GeoCacheEntry,
  GeoPoint,
  GeocodeProvider,
  RoutingProvider,
} from "./types.ts";

export class MemoryGeoCache implements GeoCache {
  private readonly entries = new Map<string, GeoCacheEntry>();

  get(key: string): GeoCacheEntry | null {
    return this.entries.get(key) ?? null;
  }

  set(key: string, value: unknown): void {
    this.entries.set(key, { value, observedAt: new Date().toISOString() });
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class NominatimGeocoder implements GeocodeProvider {
  private lastCall = 0;

  constructor(
    private readonly options: {
      fetchImpl?: typeof fetch;
      baseUrl?: string;
      userAgent?: string;
      minIntervalMs?: number;
    } = {},
  ) {}

  async geocode(address: string): Promise<GeoPoint | null> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const baseUrl = this.options.baseUrl ?? "https://nominatim.openstreetmap.org";
    const minInterval = this.options.minIntervalMs ?? 1_000;
    const wait = this.lastCall + minInterval - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCall = Date.now();

    const url = `${baseUrl.replace(/\/$/, "")}/search?format=jsonv2&limit=1&q=${encodeURIComponent(
      address,
    )}`;
    const response = await fetchImpl(url, {
      headers: {
        "user-agent":
          this.options.userAgent ?? "harness/0.1.0 (personal research tool)",
        accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`geocode ${response.status}: ${address}`);
    }
    const data = (await response.json()) as Array<{ lat?: string; lon?: string }>;
    const first = Array.isArray(data) ? data[0] : undefined;
    if (!first) return null;
    const lat = Number(first.lat);
    const lon = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  }
}

export class OpenRouteServiceRouter implements RoutingProvider {
  constructor(
    private readonly options: {
      apiKey: string;
      fetchImpl?: typeof fetch;
      baseUrl?: string;
      profile?: string;
    },
  ) {}

  async driveMinutes(from: GeoPoint, to: GeoPoint): Promise<number> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const baseUrl = this.options.baseUrl ?? "https://api.openrouteservice.org";
    const profile = this.options.profile ?? "driving-car";
    const response = await fetchImpl(
      `${baseUrl.replace(/\/$/, "")}/v2/matrix/${profile}`,
      {
        method: "POST",
        headers: {
          authorization: this.options.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          locations: [
            [from.lon, from.lat],
            [to.lon, to.lat],
          ],
          metrics: ["duration"],
          units: "m",
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`route ${response.status}`);
    }
    const data = (await response.json()) as { durations?: number[][] };
    const seconds = data.durations?.[0]?.[1];
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
      throw new Error("route returned no duration");
    }
    return Math.round((seconds / 60) * 10) / 10;
  }
}
