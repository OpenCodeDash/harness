import type {
  GeoCache,
  GeoPoint,
  GeocodeProvider,
  RoutingProvider,
} from "./types.ts";

export interface CommuteResult {
  minutes: number;
  point: GeoPoint;
}

const DAY = 24 * 60 * 60 * 1000;

const normaliseAddress = (address: string) =>
  address.trim().toLowerCase().replace(/\s+/g, " ");

const routeKey = (from: GeoPoint, to: GeoPoint) =>
  `route:${from.lat.toFixed(4)},${from.lon.toFixed(4)}->${to.lat.toFixed(4)},${to.lon.toFixed(4)}`;

export class CachedGeoService {
  private readonly now: () => number;

  constructor(
    private readonly options: {
      geocoder: GeocodeProvider;
      router: RoutingProvider;
      cache: GeoCache;
      geocodeTtlMs?: number;
      routeTtlMs?: number;
      now?: () => number;
    },
  ) {
    this.now = options.now ?? Date.now;
  }

  private read<T>(key: string, ttlMs: number): T | null {
    const entry = this.options.cache.get(key);
    if (!entry) return null;
    const age = this.now() - Date.parse(entry.observedAt);
    if (!Number.isFinite(age) || age > ttlMs) return null;
    return entry.value as T;
  }

  async geocode(address: string): Promise<GeoPoint | null> {
    const key = `geocode:${normaliseAddress(address)}`;
    const cached = this.read<GeoPoint>(
      key,
      this.options.geocodeTtlMs ?? 30 * DAY,
    );
    if (cached) return cached;

    const point = await this.options.geocoder.geocode(address);
    if (point) this.options.cache.set(key, point);
    return point;
  }

  async driveMinutes(
    from: GeoPoint,
    to: GeoPoint,
    onError?: (error: unknown) => void,
  ): Promise<number | null> {
    const key = routeKey(from, to);
    const cached = this.read<number>(
      key,
      this.options.routeTtlMs ?? DAY,
    );
    if (cached !== null) return cached;

    try {
      const minutes = await this.options.router.driveMinutes(from, to);
      this.options.cache.set(key, minutes);
      return minutes;
    } catch (error) {
      onError?.(error);
      return null;
    }
  }

  async commuteMinutes(
    address: string,
    work: GeoPoint,
    onError?: (error: unknown) => void,
    onMissing?: (reason: string) => void,
  ): Promise<CommuteResult | null> {
    const point = await this.geocode(address);
    if (!point) {
      onMissing?.("address could not be geocoded");
      return null;
    }
    const minutes = await this.driveMinutes(point, work, onError);
    if (minutes === null) return null;
    return { minutes, point };
  }
}
