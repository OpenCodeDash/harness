import type {
  GeoCache,
  GeoPoint,
  GeocodeProvider,
  RouteResult,
  RoutingProvider,
} from "./types.ts";

export interface CommuteResult extends RouteResult {
  point: GeoPoint;
}

const DAY = 24 * 60 * 60 * 1000;

const normaliseAddress = (address: string) =>
  address.trim().toLowerCase().replace(/\s+/g, " ");

const routeKey = (from: GeoPoint, to: GeoPoint) =>
  `route:v2:${from.lat.toFixed(4)},${from.lon.toFixed(4)}->${to.lat.toFixed(4)},${to.lon.toFixed(4)}`;

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

  async driveRoute(
    from: GeoPoint,
    to: GeoPoint,
    onError?: (error: unknown) => void,
  ): Promise<RouteResult | null> {
    const key = routeKey(from, to);
    const cached = this.read<RouteResult>(
      key,
      this.options.routeTtlMs ?? DAY,
    );
    if (cached) return cached;

    try {
      const route = this.options.router.driveRoute
        ? await this.options.router.driveRoute(from, to)
        : {
            minutes: await this.options.router.driveMinutes(from, to),
            distanceKm: null,
          };
      this.options.cache.set(key, route);
      return route;
    } catch (error) {
      onError?.(error);
      return null;
    }
  }

  async driveMinutes(
    from: GeoPoint,
    to: GeoPoint,
    onError?: (error: unknown) => void,
  ): Promise<number | null> {
    return (await this.driveRoute(from, to, onError))?.minutes ?? null;
  }

  async commuteRoute(
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
    const route = await this.driveRoute(point, work, onError);
    if (!route) return null;
    return { ...route, point };
  }

  async commuteMinutes(
    address: string,
    work: GeoPoint,
    onError?: (error: unknown) => void,
    onMissing?: (reason: string) => void,
  ): Promise<CommuteResult | null> {
    return this.commuteRoute(address, work, onError, onMissing);
  }
}
