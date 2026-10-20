import { registerRecipe, type Recipe } from "./recipe.ts";

const NON_HTML = /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|mp4|mp3|css|js)(\?|#|$)/i;

/**
 * Map schema.org JSON-LD documents into raw listing shapes.
 *
 * Self-contained on purpose: the runner stringifies this function into
 * `page.evaluate`, so every helper must live inside it.
 */
export function extractJsonLdListings(
  documents: unknown[],
  pageUrl: string,
): unknown[] {
  type Obj = Record<string, unknown>;

  const FIRST = 0;
  const LISTING_TYPES = [
    "product",
    "individualproduct",
    "productgroup",
    "vehicle",
    "car",
    "motorcycle",
    "realestatelisting",
    "accommodation",
    "house",
    "apartment",
    "singlefamilyresidence",
    "offer",
  ];
  const NOISE_TYPES = [
    "website",
    "organization",
    "person",
    "breadcrumblist",
    "searchaction",
    "webpage",
    "article",
    "blogposting",
    "faqpage",
    "itemlist",
  ];

  const asObject = (value: unknown): Obj | null =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Obj)
      : null;

  const asArray = (value: unknown): unknown[] => {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
  };

  const text = (value: unknown): string | undefined => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed ? trimmed : undefined;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    return undefined;
  };

  const number = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return undefined;
    const match = value.replaceAll(",", "").match(/-?\d+(?:\.\d+)?/);
    if (!match) return undefined;
    const parsed = Number(match[FIRST]);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const typeNames = (item: Obj): string[] => {
    const raw = item["@type"];
    return asArray(raw)
      .filter((entry): entry is string => typeof entry === "string")
      .map(
        (entry) =>
          entry.split(/[/#]/).pop()?.trim().toLowerCase() ?? "",
      )
      .filter(Boolean);
  };

  const hasType = (item: Obj, types: string[]): boolean =>
    typeNames(item).some((type) => types.includes(type));

  const offerList = (item: Obj): Obj[] => {
    const raw = item.offers ?? item.offer;
    return asArray(raw)
      .map(asObject)
      .filter((entry): entry is Obj => entry !== null);
  };

  const priceOf = (
    item: Obj,
  ): { price?: number; currency?: string } => {
    for (const offer of offerList(item)) {
      const specification = asObject(offer.priceSpecification);
      const price = number(offer.price) ?? number(specification?.price);
      if (price !== undefined) {
        return {
          price,
          currency:
            text(offer.priceCurrency) ?? text(specification?.priceCurrency),
        };
      }
    }
    return {
      price: number(item.price),
      currency: text(item.priceCurrency),
    };
  };

  const nameOf = (item: Obj): string | undefined =>
    text(item.name) ?? text(item.headline) ?? text(item.title);

  const brandOf = (item: Obj): string | undefined => {
    const brand = asObject(item.brand);
    return text(item.brand) ?? text(brand?.name) ?? text(item.manufacturer);
  };

  const modelOf = (item: Obj): string | undefined => {
    const model = asObject(item.model);
    return text(item.model) ?? text(model?.name);
  };

  const yearOf = (item: Obj): number | undefined => {
    const candidates = [
      item.vehicleModelDate,
      item.modelDate,
      item.productionDate,
      item.releaseDate,
      item.datePublished,
    ];
    for (const value of candidates) {
      const raw = text(value);
      if (!raw) continue;
      const match = raw.match(/\b(19|20)\d{2}\b/);
      if (match) return Number(match[FIRST]);
    }
    return number(item.vehicleModelDate);
  };

  const mileageOf = (item: Obj): number | undefined => {
    const odometer = asObject(item.mileageFromOdometer);
    return number(odometer?.value) ?? number(item.mileage);
  };

  const conditionOf = (item: Obj): string | undefined => {
    const raw = text(item.itemCondition);
    if (!raw) return undefined;
    const token = raw.split(/[/#]/).pop()?.toLowerCase() ?? raw.toLowerCase();
    if (token.includes("new")) return "new";
    if (token.includes("used")) return "used";
    if (token.includes("refurb")) return "refurbished";
    if (token.includes("damaged")) return "damaged";
    if (token.includes("broken")) return "damaged";
    const cleaned = token.replace(/condition$/, "").replaceAll(/[^a-z]+/g, " ").trim();
    return cleaned || undefined;
  };

  const addressOf = (item: Obj): string | undefined => {
    const address = asObject(item.address);
    if (!address) return text(item.address);
    const parts = [
      text(address.streetAddress),
      text(address.addressLocality),
      text(address.addressRegion),
      text(address.postalCode),
      text(address.addressCountry),
    ].filter((part): part is string => Boolean(part));
    return parts.length ? parts.join(", ") : undefined;
  };

  const localityOf = (item: Obj): string | undefined => {
    const address = asObject(item.address);
    const area = asObject(item.areaServed);
    return (
      text(item.location) ??
      text(address?.addressLocality) ??
      text(address?.addressRegion) ??
      text(item.areaServed) ??
      text(area?.name)
    );
  };

  const geoOf = (
    item: Obj,
  ): { lat?: number; lon?: number } => {
    const geo = asObject(item.geo);
    return {
      lat: number(geo?.latitude),
      lon: number(geo?.longitude),
    };
  };

  const descriptionOf = (item: Obj): string | undefined => {
    const raw = text(item.description);
    if (!raw) return undefined;
    return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  };

  const urlOf = (item: Obj): string => {
    const absolute = (value: string | undefined): string | undefined => {
      if (!value) return undefined;
      try {
        return new URL(value, pageUrl).toString();
      } catch {
        return value;
      }
    };
    const direct = absolute(text(item.url));
    if (direct) return direct;
    const main = item.mainEntityOfPage;
    const mainObject = asObject(main);
    const fromMain = absolute(
      text(main) ?? text(mainObject?.["@id"]) ?? text(mainObject?.url),
    );
    if (fromMain) return fromMain;
    const id = text(item["@id"]);
    if (id && /^https?:\/\//i.test(id)) return id;
    return pageUrl;
  };

  const externalIdOf = (item: Obj, url: string): string => {
    for (const key of ["sku", "productID", "gtin", "gtin13", "mpn", "id"]) {
      const value = text(item[key]);
      if (value) return value;
    }
    const identifier = asObject(item.identifier);
    if (identifier) {
      const value = text(identifier.value) ?? text(identifier.name);
      if (value) return value;
    }
    try {
      const parsed = new URL(url);
      const segment = parsed.pathname
        .split("/")
        .filter(Boolean)
        .pop();
      if (segment) return decodeURIComponent(segment);
      return parsed.hostname;
    } catch {
      return url;
    }
  };

  const mediaOf = (item: Obj): string[] => {
    const raw = asArray(item.image).concat(asArray(item.photo));
    const urls: string[] = [];
    for (const entry of raw) {
      const value =
        text(entry) ??
        text(asObject(entry)?.url) ??
        text(asObject(entry)?.contentUrl);
      if (value && !urls.includes(value)) urls.push(value);
    }
    return urls;
  };

  const collect = (value: unknown, output: Obj[]): void => {
    if (Array.isArray(value)) {
      for (const entry of value) collect(entry, output);
      return;
    }
    const item = asObject(value);
    if (!item) return;
    for (const entry of asArray(item["@graph"])) collect(entry, output);
    for (const entry of asArray(item.itemListElement)) {
      const listItem = asObject(entry);
      if (!listItem) continue;
      collect(listItem.item ?? listItem, output);
    }
    output.push(item);
  };

  const score = (item: Obj): number => {
    let value = hasType(item, LISTING_TYPES) ? 20 : 0;
    if (nameOf(item)) value += 4;
    if (offerList(item).length || priceOf(item).price !== undefined) value += 6;
    if (descriptionOf(item)) value += 2;
    if (mediaOf(item).length) value += 1;
    if (hasType(item, NOISE_TYPES)) value -= 30;
    return value;
  };

  const collected: Obj[] = [];
  for (const document of documents) collect(document, collected);

  const usable = collected.filter((item) => {
    if (hasType(item, NOISE_TYPES) && !hasType(item, LISTING_TYPES)) return false;
    return (
      hasType(item, LISTING_TYPES) ||
      offerList(item).length > 0 ||
      priceOf(item).price !== undefined
    );
  });

  const ranked = usable
    .map((item, index) => ({ item, index, score: score(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);

  const seen = new Set<string>();
  const listings: unknown[] = [];
  for (const item of ranked) {
    const url = urlOf(item);
    const externalId = externalIdOf(item, url);
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const offer = offerList(item)[FIRST];
    const price = priceOf(item);
    const geo = geoOf(item);
    const fields: Obj = {};
    const put = (key: string, value: unknown): void => {
      if (value === undefined || value === null || value === "") return;
      fields[key] = value;
    };

    put("title", nameOf(item));
    put("description", descriptionOf(item));
    put("price", price.price);
    put("currency", price.currency);
    put("brand", brandOf(item));
    put("model", modelOf(item));
    put("year", yearOf(item));
    put("mileage", mileageOf(item));
    put("condition", conditionOf(item));
    put("color", text(item.color));
    put("address", addressOf(item));
    put("location", localityOf(item));
    put("lat", geo.lat);
    put("lon", geo.lon);
    put("availability", text(offer?.availability));
    put("seller", text(asObject(item.seller)?.name) ?? text(item.seller));

    listings.push({
      externalId,
      url,
      fields,
      media: mediaOf(item),
      raw: item,
    });
  }
  return listings;
}

export const jsonLdRecipe: Recipe = {
  id: "jsonld",
  domain: "generic",
  version: 1,
  priority: 0,
  discovery: {
    label: "Open web (JSON-LD)",
    queryTemplates: [
      { template: "{prompt}" },
      {
        template: "{area} {bedrooms} bedroom",
        requires: ["area", "bedrooms"],
      },
      { template: "{area} {brand} {model}", requires: ["area", "brand"] },
      { template: "{area} {price}", requires: ["area", "price"] },
    ],
  },
  matches: (url) => /^https?:\/\//i.test(url) && !NON_HTML.test(url),
  isListing: () => true,
  searchReady: `() => document.readyState !== 'loading'`,
  listingReady: `() => document.readyState !== 'loading'`,
  searchScript: `() => {
    const __name = (fn) => fn;
    const documents = [];
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      const raw = el.textContent || '';
      if (!raw.trim()) continue;
      try { documents.push(JSON.parse(raw)); } catch (error) {}
    }
    return (${extractJsonLdListings.toString()})(documents, location.href);
  }`,
  listingScript: `() => {
    const __name = (fn) => fn;
    const documents = [];
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      const raw = el.textContent || '';
      if (!raw.trim()) continue;
      try { documents.push(JSON.parse(raw)); } catch (error) {}
    }
    const listings = (${extractJsonLdListings.toString()})(documents, location.href);
    return listings.length ? listings[0] : null;
  }`,
};

registerRecipe(jsonLdRecipe);
