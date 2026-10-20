import { registerRecipe, type Recipe } from "./recipe.ts";

export function extractSearchListings(state: unknown): unknown[] {
  const source = state as {
    listing?: {
      cachedSearchResults?: {
        ids?: Array<string | number>;
        entities?: Record<string, { item?: unknown } | unknown>;
      };
    };
  };
  const results = source?.listing?.cachedSearchResults;
  if (!results?.ids || !results.entities) return [];

  const parseMoney = (value: unknown): number | undefined => {
    if (typeof value === "number") return value;
    const parsed = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const mapType = (value: unknown): string | undefined => {
    const type = String(value ?? "").toLowerCase();
    if (!type) return undefined;
    if (type.includes("town")) return "townhouse";
    if (type.includes("apartment")) return "apartment";
    if (type.includes("unit")) return "unit";
    if (type.includes("studio")) return "studio";
    if (type.includes("house")) return "house";
    return type;
  };

  const fullPhoto = (value: unknown): string =>
    String(value ?? "")
      .replace("/352x264c/", "/full/")
      .replace("/thumb/", "/full/");

  const listings: unknown[] = [];
  for (const id of results.ids) {
    const entry = results.entities[id] ?? results.entities[String(id)];
    const item = (entry as { item?: Record<string, unknown> })?.item ??
      (entry as Record<string, unknown> | undefined);
    if (!item) continue;

    const photos = Array.isArray(item.photoUrls) ? item.photoUrls : [];
    const canonical =
      typeof item.canonicalPath === "string" ? item.canonicalPath : "";
    const geo = item.geographicLocation as
      | { latitude?: number; longitude?: number }
      | undefined;
    const agency = item.agency as { name?: string } | undefined;

    listings.push({
      source: "trademe",
      externalId: String(item.listingId ?? id),
      url: canonical ? `https://www.trademe.co.nz/a${canonical}` : "",
      fields: {
        title: item.title,
        rent:
          typeof item.rentPerWeek === "number"
            ? item.rentPerWeek
            : parseMoney(item.priceDisplay),
        bedrooms: item.bedrooms,
        bathrooms: item.bathrooms,
        parking:
          item.parking === "Yes" || (Number(item.totalParking) || 0) > 0,
        address: item.address,
        suburb: item.suburb,
        district: item.district,
        region: item.region,
        property_type: mapType(item.propertyType),
        available_from: item.availableFrom,
        whiteware: item.whiteware === "Yes",
        lat: geo?.latitude,
        lon: geo?.longitude,
        agency: agency?.name,
      },
      media: photos.map(fullPhoto).filter(Boolean),
      raw: item,
    });
  }
  return listings;
}

export function extractListingDetail(state: unknown): unknown {
  const source = state as {
    listing?: {
      cachedDetails?: {
        ids?: Array<string | number>;
        entities?: Record<string, { item?: unknown } | unknown>;
      };
    };
  };
  const details = source?.listing?.cachedDetails;
  if (!details?.ids?.length || !details.entities) return null;

  const id = details.ids[0];
  if (id === undefined) return null;
  const entry = details.entities[id] ?? details.entities[String(id)];
  const item = (entry as { item?: Record<string, unknown> })?.item ??
    (entry as Record<string, unknown> | undefined);
  if (!item) return null;

  const parseNumber = (value: unknown): number | undefined => {
    const parsed = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const mapType = (value: unknown): string | undefined => {
    const type = String(value ?? "").toLowerCase();
    if (!type) return undefined;
    if (type.includes("town")) return "townhouse";
    if (type.includes("apartment")) return "apartment";
    if (type.includes("unit")) return "unit";
    if (type.includes("studio")) return "studio";
    if (type.includes("house")) return "house";
    return type;
  };

  const attributes = Array.isArray(item.attributes) ? item.attributes : [];
  const attribute = (name: string): string | undefined => {
    const found = attributes.find(
      (entry) => (entry as { name?: string })?.name === name,
    );
    return found ? String((found as { value?: unknown }).value ?? "") : undefined;
  };

  const photos = Array.isArray(item.photos) ? item.photos : [];
  const media = photos
    .map((photo) => {
      const value = (photo as { value?: Record<string, string> })?.value ?? {};
      return value.fullSize ?? value.large ?? value.gallery ?? value.list ?? "";
    })
    .filter(Boolean);

  const parking = attribute("off-street_parking") ?? attribute("parking");
  const canonical =
    typeof item.canonicalPath === "string" ? item.canonicalPath : "";

  return {
    source: "trademe",
    externalId: String(item.listingId ?? id),
    url: canonical ? `https://www.trademe.co.nz/a${canonical}` : "",
    fields: {
      description: item.body,
      bedrooms: parseNumber(attribute("bedrooms")),
      bathrooms: parseNumber(attribute("bathrooms")),
      property_type: mapType(attribute("property_type")),
      available_from: attribute("available"),
      furnished: attribute("furnishings") === "Yes",
      parking: parking === undefined ? undefined : (parseNumber(parking) ?? 0) > 0,
    },
    media,
    raw: item,
  };
}

export function isTradeMeListingUrl(url: string): boolean {
  return /\/listing\/\d+/.test(url);
}

export const trademeRecipe: Recipe = {
  id: "trademe",
  domain: "property",
  version: 1,
  matches: (url) => {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname.endsWith("trademe.co.nz") &&
        /\/a\/property\/residential\/rent\//.test(parsed.pathname)
      );
    } catch {
      return false;
    }
  },
  isListing: isTradeMeListingUrl,
  searchReady: `() => {
    const el = document.getElementById('frend-state');
    if (!el) return false;
    try {
      const state = JSON.parse(el.textContent).NGRX_STATE;
      const results = state && state.listing && state.listing.cachedSearchResults;
      return !!(results && Array.isArray(results.ids) && results.ids.length);
    } catch (error) {
      return false;
    }
  }`,
  listingReady: `() => {
    const el = document.getElementById('frend-state');
    if (!el) return false;
    try {
      const state = JSON.parse(el.textContent).NGRX_STATE;
      const details = state && state.listing && state.listing.cachedDetails;
      return !!(details && Array.isArray(details.ids) && details.ids.length);
    } catch (error) {
      return false;
    }
  }`,
  searchScript: `() => {
    const __name = (fn) => fn;
    const el = document.getElementById('frend-state');
    if (!el) throw new Error('Trade Me state missing');
    const state = JSON.parse(el.textContent).NGRX_STATE;
    return (${extractSearchListings.toString()})(state);
  }`,
  listingScript: `() => {
    const __name = (fn) => fn;
    const el = document.getElementById('frend-state');
    if (!el) throw new Error('Trade Me state missing');
    const state = JSON.parse(el.textContent).NGRX_STATE;
    return (${extractListingDetail.toString()})(state);
  }`,
};

registerRecipe(trademeRecipe);
