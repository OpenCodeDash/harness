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
        price: parseMoney(item.priceDisplay),
        rent:
          typeof item.rentPerWeek === "number"
            ? item.rentPerWeek
            : parseMoney(item.priceDisplay),
        condition: item.condition,
        brand: item.brand,
        model: item.model,
        location: item.suburb ?? item.district ?? item.region,
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
    const target = name.trim().toLowerCase();
    const found = attributes.find(
      (entry) =>
        String((entry as { name?: unknown })?.name ?? "")
          .trim()
          .toLowerCase() === target,
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
  const furnishings = attribute("furnishings");
  const whiteware = attribute("whiteware");
  const pets = attribute("pets");
  const geo = item.geographicLocation as
    | { latitude?: number; longitude?: number }
    | undefined;
  const canonical =
    typeof item.canonicalPath === "string" ? item.canonicalPath : "";

  return {
    source: "trademe",
    externalId: String(item.listingId ?? id),
    url: canonical ? `https://www.trademe.co.nz/a${canonical}` : "",
    fields: {
      title: item.title,
      description: item.body,
      price: parseNumber(item.priceDisplay),
      condition: item.condition ?? attribute("condition"),
      brand: item.brand ?? attribute("brand"),
      model: item.model ?? attribute("model"),
      location: item.suburb ?? item.district ?? item.region,
      specs: Object.fromEntries(
        attributes
          .map((entry) => entry as { name?: unknown; value?: unknown })
          .filter(
            (entry) =>
              typeof entry.name === "string" &&
              entry.value !== undefined &&
              entry.value !== null &&
              String(entry.value).trim() !== "",
          )
          .map((entry) => [
            String(entry.name)
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_+|_+$/g, ""),
            String(entry.value),
          ]),
      ),
      rent:
        typeof item.rentPerWeek === "number"
          ? item.rentPerWeek
          : parseNumber(item.priceDisplay),
      bedrooms: parseNumber(attribute("bedrooms")),
      bathrooms: parseNumber(attribute("bathrooms")),
      property_type: mapType(attribute("property_type") ?? item.propertyType),
      available_from: attribute("available") ?? item.availableFrom,
      furnished:
        furnishings === undefined ? undefined : furnishings === "Yes",
      whiteware: whiteware === undefined ? undefined : whiteware === "Yes",
      pets:
        pets === undefined
          ? undefined
          : /^no$/i.test(pets)
            ? "no"
            : /^yes$/i.test(pets)
              ? "yes"
              : "negotiable",
      parking: parking === undefined ? undefined : (parseNumber(parking) ?? 0) > 0,
      address: attribute("location") ?? item.address,
      suburb: attribute("suburb") ?? item.suburb,
      district: attribute("district") ?? item.district,
      region: attribute("region") ?? item.region,
      lat: geo?.latitude,
      lon: geo?.longitude,
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
  domain: "trademe",
  version: 1,
  priority: 10,
  discovery: {
    label: "Trade Me",
    sites: ["trademe.co.nz"],
    queryTemplates: [
      { template: "{prompt}", site: "trademe.co.nz" },
      {
        template: "{area} rent {bedrooms} bedroom",
        domains: ["property"],
        requires: ["area"],
        site: "trademe.co.nz",
      },
      {
        template: "rental {area} {rent}",
        domains: ["property"],
        requires: ["area"],
        site: "trademe.co.nz",
      },
      {
        template: "{area} {property_type} for rent",
        domains: ["property"],
        requires: ["area"],
        site: "trademe.co.nz",
      },
      {
        template: "{prompt}",
        domains: ["cars"],
        site: "trademe.co.nz/motors",
      },
      {
        template: "{brand} {model} {area}",
        domains: ["cars"],
        requires: ["brand"],
        site: "trademe.co.nz/motors",
      },
      {
        template: "used car {area} {price}",
        domains: ["cars"],
        requires: ["area"],
        site: "trademe.co.nz/motors",
      },
      {
        template: "{prompt}",
        domains: ["laptops"],
        site: "trademe.co.nz/computers",
      },
      {
        template: "{brand} {model} laptop {area}",
        domains: ["laptops"],
        requires: ["brand"],
        site: "trademe.co.nz/computers",
      },
      {
        template: "used laptop {area} {price}",
        domains: ["laptops"],
        requires: ["area"],
        site: "trademe.co.nz/computers",
      },
    ],
  },
  matches: (url) => {
    try {
      return new URL(url).hostname.endsWith("trademe.co.nz");
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
