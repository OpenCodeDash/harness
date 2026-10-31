export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface GeoCacheEntry {
  value: unknown;
  observedAt: string;
}

export interface GeoCache {
  get(key: string): GeoCacheEntry | null;
  set(key: string, value: unknown): void;
}

export interface GeocodeProvider {
  geocode(address: string): Promise<GeoPoint | null>;
}

export interface RouteResult {
  minutes: number;
  distanceKm: number | null;
}

export interface RoutingProvider {
  driveMinutes(from: GeoPoint, to: GeoPoint): Promise<number>;
  /** Optional richer route so derived distance/cost criteria can use it. */
  driveRoute?(from: GeoPoint, to: GeoPoint): Promise<RouteResult>;
}
