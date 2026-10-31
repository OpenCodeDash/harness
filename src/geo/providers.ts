import type {
  GeoCache,
  GeoCacheEntry,
  GeoPoint,
  GeocodeProvider,
  RouteResult,
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

interface NominatimResult {
  lat?: string;
  lon?: string;
  display_name?: string;
  addresstype?: string;
  type?: string;
}

interface PhotonFeature {
  properties?: {
    housenumber?: string;
    street?: string;
    name?: string;
    type?: string;
    osm_value?: string;
  };
  geometry?: { coordinates?: [number, number] };
}

function houseNumber(address: string): string | null {
  return /^\s*(\d+[a-z]?)\b/i.exec(address)?.[1]?.toLowerCase() ?? null;
}

function nominatimPrecise(result: NominatimResult, address: string): boolean {
  const house = houseNumber(address);
  if (!house) return true;
  const kind = `${result.addresstype ?? ""} ${result.type ?? ""}`.toLowerCase();
  if (!kind.trim()) return true;
  if (/road|street|highway|footway|cycleway|path/.test(kind)) return false;
  const display = (result.display_name ?? "").toLowerCase();
  return !display || new RegExp(`\\b${house}\\b`, "i").test(display);
}

function photonPoint(feature: PhotonFeature): GeoPoint | null {
  const coordinates = feature.geometry?.coordinates;
  if (!coordinates || coordinates.length < 2) return null;
  const [lon, lat] = coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function photonPrecise(feature: PhotonFeature, address: string): boolean {
  const house = houseNumber(address);
  if (!house) return true;
  const properties = feature.properties ?? {};
  if (properties.housenumber === house) return true;
  return false;
}

export class NominatimGeocoder implements GeocodeProvider {
  private lastCall = 0;

  constructor(
    private readonly options: {
      fetchImpl?: typeof fetch;
      baseUrl?: string;
      photonUrl?: string;
      userAgent?: string;
      minIntervalMs?: number;
    } = {},
  ) {}

  private async nominatim(
    address: string,
    fetchImpl: typeof fetch,
  ): Promise<NominatimResult[]> {
    const baseUrl = this.options.baseUrl ?? "https://nominatim.openstreetmap.org";
    const minInterval = this.options.minIntervalMs ?? 1_000;
    const wait = this.lastCall + minInterval - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCall = Date.now();

    const url = `${baseUrl.replace(/\/$/, "")}/search?format=jsonv2&limit=5&addressdetails=1&q=${encodeURIComponent(
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
    const data = (await response.json()) as NominatimResult[];
    return Array.isArray(data) ? data : [];
  }

  private async photon(
    address: string,
    fetchImpl: typeof fetch,
  ): Promise<PhotonFeature[]> {
    const baseUrl = this.options.photonUrl ?? "https://photon.komoot.io";
    const url = `${baseUrl.replace(/\/$/, "")}/api/?limit=5&lang=en&q=${encodeURIComponent(
      address,
    )}`;
    const response = await fetchImpl(url, {
      headers: {
        "user-agent":
          this.options.userAgent ?? "harness/0.1.0 (personal research tool)",
        accept: "application/json",
      },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      features?: PhotonFeature[];
    };
    return Array.isArray(data.features) ? data.features : [];
  }

  async geocode(address: string): Promise<GeoPoint | null> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const variants = [
      address,
      /new zealand/i.test(address) ? null : `${address}, New Zealand`,
    ].filter((value): value is string => Boolean(value));

    let fallback: GeoPoint | null = null;
    for (const query of variants) {
      const results = await this.nominatim(query, fetchImpl);
      for (const result of results) {
        const lat = Number(result.lat);
        const lon = Number(result.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const point = { lat, lon };
        if (nominatimPrecise(result, query)) return point;
        fallback ??= point;
      }

      const features = await this.photon(query, fetchImpl);
      for (const feature of features) {
        const point = photonPoint(feature);
        if (!point) continue;
        if (photonPrecise(feature, query)) return point;
        fallback ??= point;
      }
    }
    return fallback;
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

  async driveRoute(from: GeoPoint, to: GeoPoint): Promise<RouteResult> {
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
          metrics: ["duration", "distance"],
          units: "m",
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`route ${response.status}`);
    }
    const data = (await response.json()) as {
      durations?: number[][];
      distances?: number[][];
    };
    const seconds = data.durations?.[0]?.[1];
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
      throw new Error("route returned no duration");
    }
    const metres = data.distances?.[0]?.[1];
    return {
      minutes: Math.round((seconds / 60) * 10) / 10,
      distanceKm:
        typeof metres === "number" && Number.isFinite(metres)
          ? Math.round((metres / 1000) * 100) / 100
          : null,
    };
  }

  async driveMinutes(from: GeoPoint, to: GeoPoint): Promise<number> {
    return (await this.driveRoute(from, to)).minutes;
  }
}

/**
 * Public OSRM routing. Used when no OpenRouteService key is configured so a
 * commute criterion still resolves instead of hard-failing every listing.
 * The demo server is rate limited; set OSRM_URL for a self-hosted instance.
 */
const OSRM_BASES = [
  "https://routing.openstreetmap.de/routed-car",
  "https://router.project-osrm.org",
];

export class OsrmRouter implements RoutingProvider {
  constructor(
    private readonly options: {
      baseUrl?: string;
      baseUrls?: string[];
      fetchImpl?: typeof fetch;
      profile?: string;
    } = {},
  ) {}

  async driveRoute(from: GeoPoint, to: GeoPoint): Promise<RouteResult> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const profile = this.options.profile ?? "driving";
    const bases = this.options.baseUrls ?? [
      this.options.baseUrl ?? OSRM_BASES[0]!,
      ...(this.options.baseUrl ? [] : OSRM_BASES.slice(1)),
    ];
    let lastError: unknown = null;
    for (const baseUrl of bases) {
      try {
        const response = await fetchImpl(
          `${baseUrl.replace(/\/$/, "")}/route/v1/${profile}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`,
          { headers: { accept: "application/json" } },
        );
        if (!response.ok) throw new Error(`route ${response.status}`);
        const data = (await response.json()) as {
          routes?: Array<{ duration?: number; distance?: number }>;
        };
        const route = data.routes?.[0];
        const seconds = route?.duration;
        if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
          throw new Error("route returned no duration");
        }
        return {
          minutes: Math.round((seconds / 60) * 10) / 10,
          distanceKm:
            typeof route?.distance === "number" &&
            Number.isFinite(route.distance)
              ? Math.round((route.distance / 1000) * 100) / 100
              : null,
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("no OSRM endpoint configured");
  }

  async driveMinutes(from: GeoPoint, to: GeoPoint): Promise<number> {
    return (await this.driveRoute(from, to)).minutes;
  }
}
