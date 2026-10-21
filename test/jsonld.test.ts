import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import {
  extractJsonLdListings,
  jsonLdRecipe,
} from "../src/sources/jsonld.ts";
import { getRecipeFor, RecipeError, validateRawListing } from "../src/sources/index.ts";

const PRODUCT = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "ThinkPad T14",
  description: "<p>Ryzen 7, 32GB RAM</p>",
  sku: "TP-T14",
  brand: { "@type": "Brand", name: "Lenovo" },
  model: "T14 Gen 4",
  image: ["/img/1.jpg", { "@type": "ImageObject", url: "https://cdn.test/2.jpg" }],
  itemCondition: "https://schema.org/UsedCondition",
  color: "Black",
  offers: {
    "@type": "Offer",
    price: "1,450.00",
    priceCurrency: "NZD",
    availability: "https://schema.org/InStock",
  },
};

const VEHICLE = {
  "@context": "https://schema.org",
  "@type": "Vehicle",
  name: "2019 Toyota Corolla",
  brand: "Toyota",
  model: "Corolla",
  vehicleModelDate: "2019-03",
  mileageFromOdometer: { "@type": "QuantitativeValue", value: 85_000, unitCode: "KMT" },
  itemCondition: "https://schema.org/UsedCondition",
  offers: { "@type": "Offer", price: 15_990, priceCurrency: "NZD" },
  address: {
    "@type": "PostalAddress",
    streetAddress: "1 Main St",
    addressLocality: "Wellington",
    addressRegion: "Wellington",
    postalCode: "6011",
    addressCountry: "NZ",
  },
  geo: { "@type": "GeoCoordinates", latitude: -41.28, longitude: 174.77 },
  image: "https://cdn.test/car.jpg",
};

function runScript(script: string, html: string, pageUrl: string): unknown {
  const { document } = parseHTML(html);
  const globals = globalThis as {
    document?: unknown;
    location?: unknown;
  };
  globals.document = document;
  globals.location = { href: pageUrl };
  try {
    const run = new Function(`return (${script})()`) as () => unknown;
    return run();
  } finally {
    delete globals.document;
    delete globals.location;
  }
}

const htmlFor = (payload: unknown): string =>
  `<html><head><script type="application/ld+json">${JSON.stringify(
    payload,
  )}</script></head><body></body></html>`;

test("maps a Product with offers, brand, condition, and media", () => {
  const pageUrl = "https://shop.test/products/thinkpad";
  const listings = extractJsonLdListings([PRODUCT], pageUrl) as Array<{
    externalId: string;
    url: string;
    fields: Record<string, unknown>;
    media: string[];
  }>;

  assert.equal(listings.length, 1);
  const listing = listings[0]!;
  assert.equal(listing.externalId, "TP-T14");
  assert.equal(listing.url, pageUrl);
  assert.equal(listing.fields.title, "ThinkPad T14");
  assert.equal(listing.fields.description, "Ryzen 7, 32GB RAM");
  assert.equal(listing.fields.price, 1450);
  assert.equal(listing.fields.currency, "NZD");
  assert.equal(listing.fields.brand, "Lenovo");
  assert.equal(listing.fields.model, "T14 Gen 4");
  assert.equal(listing.fields.condition, "used");
  assert.equal(listing.fields.color, "Black");
  assert.equal(listing.fields.availability, "https://schema.org/InStock");
  assert.deepEqual(listing.media, ["/img/1.jpg", "https://cdn.test/2.jpg"]);
});

test("maps a Vehicle with year, mileage, address, and geo", () => {
  const pageUrl = "https://cars.test/listing/abc-123";
  const listings = extractJsonLdListings([VEHICLE], pageUrl) as Array<{
    externalId: string;
    fields: Record<string, unknown>;
  }>;

  const listing = listings[0]!;
  assert.equal(listing.externalId, "abc-123");
  assert.equal(listing.fields.year, 2019);
  assert.equal(listing.fields.mileage, 85_000);
  assert.equal(listing.fields.price, 15_990);
  assert.equal(listing.fields.brand, "Toyota");
  assert.equal(listing.fields.model, "Corolla");
  assert.equal(
    listing.fields.address,
    "1 Main St, Wellington, Wellington, 6011, NZ",
  );
  assert.equal(listing.fields.location, "Wellington");
  assert.equal(listing.fields.lat, -41.28);
  assert.equal(listing.fields.lon, 174.77);
});

test("flattens @graph and ItemLists without returning site noise", () => {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ItemList",
        itemListElement: [
          {
            "@type": "ListItem",
            item: {
              "@type": "Product",
              name: "A",
              url: "/a",
              offers: { price: 10 },
            },
          },
          {
            "@type": "ListItem",
            item: {
              "@type": "Product",
              name: "B",
              url: "/b",
              offers: { price: 20 },
            },
          },
        ],
      },
      { "@type": "WebSite", name: "Shop", url: "https://shop.test" },
    ],
  };

  const listings = extractJsonLdListings([graph], "https://shop.test/list") as Array<{
    externalId: string;
    url: string;
  }>;
  assert.deepEqual(
    listings.map((listing) => listing.externalId).sort(),
    ["a", "b"],
  );
  assert.ok(listings.every((listing) => listing.url !== "https://shop.test"));
});

test("recipe scripts parse JSON-LD in a document", () => {
  const pageUrl = "https://shop.test/products/thinkpad";
  const html = htmlFor(PRODUCT);

  const listing = runScript(jsonLdRecipe.listingScript, html, pageUrl) as {
    externalId: string;
    fields: Record<string, unknown>;
  };
  assert.equal(listing.externalId, "TP-T14");
  assert.equal(listing.fields.price, 1450);

  const listings = runScript(jsonLdRecipe.searchScript, html, pageUrl) as unknown[];
  assert.equal(listings.length, 1);
});

test("pages without JSON-LD fail loudly through validation", () => {
  const pageUrl = "https://shop.test/empty";
  const result = runScript(
    jsonLdRecipe.listingScript,
    "<html><body>no structured data</body></html>",
    pageUrl,
  );
  assert.equal(result, null);
  assert.throws(
    () => validateRawListing(result, jsonLdRecipe, pageUrl),
    RecipeError,
  );
});

test("generic recipe is a fallback and site recipes win", () => {
  assert.equal(getRecipeFor("https://shop.test/product/1")?.id, "jsonld");
  assert.equal(getRecipeFor("https://cars.test/listing/1")?.id, "jsonld");
  assert.equal(getRecipeFor("https://shop.test/report.pdf"), null);
  assert.equal(
    getRecipeFor(
      "https://www.trademe.co.nz/a/property/residential/rent/wellington/x/listing/1",
    )?.id,
    "trademe",
  );
  assert.equal(jsonLdRecipe.isListing("https://shop.test/product/1"), false);
});

test("maps additionalProperty into specs", () => {
  const product = {
    ...PRODUCT,
    additionalProperty: [
      { "@type": "PropertyValue", name: "RAM Size", value: "32GB" },
      { "@type": "PropertyValue", name: "Battery Health", value: "91%" },
    ],
  };
  const [listing] = extractJsonLdListings(
    [product],
    "https://shop.test/p/1",
  ) as Array<{ fields: Record<string, unknown> }>;
  assert.deepEqual(listing?.fields.specs, {
    ram_size: "32GB",
    battery_health: "91%",
  });
});
