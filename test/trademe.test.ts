import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import {
  extractListingDetail,
  extractSearchListings,
  isTradeMeListingUrl,
  trademeRecipe,
} from "../src/sources/trademe.ts";
import { getRecipeFor } from "../src/sources/recipe.ts";

const SEARCH_STATE = {
  listing: {
    cachedSearchResults: {
      ids: [6179337650, 42],
      entities: {
        6179337650: {
          item: {
            listingId: 6179337650,
            title: "Johnsonville, 3 bedrooms, $720 pw",
            canonicalPath:
              "/property/residential/rent/wellington/johnsonville/listing/6179337650",
            rentPerWeek: 720,
            priceDisplay: "$720 per week",
            bedrooms: 3,
            bathrooms: 1,
            parking: "Yes",
            totalParking: 2,
            address: "1/1A Pollen Street",
            suburb: "Johnsonville",
            district: "Wellington",
            region: "Wellington",
            propertyType: "House",
            availableFrom: "21/10/2026",
            whiteware: "No",
            photoUrls: [
              "https://trademe.tmcdn.co.nz/photoserver/thumb/1.jpg",
              "https://trademe.tmcdn.co.nz/photoserver/thumb/2.jpg",
            ],
            geographicLocation: { latitude: -41.22, longitude: 174.8 },
            agency: { name: "myRent.co.nz" },
          },
        },
        42: {
          item: {
            listingId: 42,
            canonicalPath: "/property/residential/rent/wellington/x/listing/42",
            priceDisplay: "$650 per week",
            bedrooms: 2,
            bathrooms: 1,
            parking: "No",
            totalParking: 0,
            propertyType: "Townhouse",
            photoUrls: [],
          },
        },
      },
    },
  },
};

const DETAIL_STATE = {
  listing: {
    cachedDetails: {
      ids: [6179337650],
      entities: {
        6179337650: {
          item: {
            listingId: 6179337650,
            canonicalPath:
              "/property/residential/rent/wellington/johnsonville/listing/6179337650",
            body: "Renovated and sunny.",
            priceDisplay: "$720 per week",
            geographicLocation: { latitude: -41.22, longitude: 174.8 },
            photos: [
              { value: { thumbnail: "https://x/thumb/1.jpg", fullSize: "https://x/full/1.jpg" } },
              { value: { fullSize: "https://x/full/2.jpg" } },
            ],
            attributes: [
              { name: "location", value: "1/1A Pollen Street, Johnsonville, Wellington, Wellington" },
              { name: "suburb", value: "Johnsonville" },
              { name: "district", value: "Wellington" },
              { name: "region", value: "Wellington" },
              { name: "bedrooms", value: "3 bedrooms" },
              { name: "bathrooms", value: "1 bathroom" },
              { name: "property_type", value: "House" },
              { name: "available", value: "Wed, 21 Oct 2026" },
              { name: "furnishings", value: "No" },
              { name: "off-street_parking", value: "2" },
            ],
          },
        },
      },
    },
  },
};

test("maps Trade Me search state into raw listings", () => {
  const listings = extractSearchListings(SEARCH_STATE) as Array<{
    externalId: string;
    url: string;
    fields: Record<string, unknown>;
    media: string[];
  }>;

  assert.equal(listings.length, 2);
  const first = listings[0]!;
  assert.equal(first.externalId, "6179337650");
  assert.equal(
    first.url,
    "https://www.trademe.co.nz/a/property/residential/rent/wellington/johnsonville/listing/6179337650",
  );
  assert.equal(first.fields.rent, 720);
  assert.equal(first.fields.bedrooms, 3);
  assert.equal(first.fields.parking, true);
  assert.equal(first.fields.property_type, "house");
  assert.equal(first.fields.whiteware, false);
  assert.deepEqual(first.media, [
    "https://trademe.tmcdn.co.nz/photoserver/full/1.jpg",
    "https://trademe.tmcdn.co.nz/photoserver/full/2.jpg",
  ]);

  const second = listings[1]!;
  assert.equal(second.fields.rent, 650);
  assert.equal(second.fields.parking, false);
  assert.equal(second.fields.property_type, "townhouse");
});

test("maps Trade Me detail state into description, photos, and attributes", () => {
  const detail = extractListingDetail(DETAIL_STATE) as {
    externalId: string;
    fields: Record<string, unknown>;
    media: string[];
  };
  assert.equal(detail.externalId, "6179337650");
  assert.equal(detail.fields.description, "Renovated and sunny.");
  assert.equal(detail.fields.rent, 720);
  assert.equal(
    detail.fields.address,
    "1/1A Pollen Street, Johnsonville, Wellington, Wellington",
  );
  assert.equal(detail.fields.suburb, "Johnsonville");
  assert.equal(detail.fields.district, "Wellington");
  assert.equal(detail.fields.region, "Wellington");
  assert.equal(detail.fields.lat, -41.22);
  assert.equal(detail.fields.lon, 174.8);
  assert.equal(detail.fields.bedrooms, 3);
  assert.equal(detail.fields.bathrooms, 1);
  assert.equal(detail.fields.property_type, "house");
  assert.equal(detail.fields.parking, true);
  assert.equal(detail.fields.furnished, false);
  assert.deepEqual(detail.media, ["https://x/full/1.jpg", "https://x/full/2.jpg"]);
});

test("missing state returns empty or null instead of throwing", () => {
  assert.deepEqual(extractSearchListings({}), []);
  assert.equal(extractListingDetail({}), null);
});

test("recipe scripts execute in a document and read frend-state", () => {
  const html = `<html><body><script id="frend-state" type="application/json">${JSON.stringify(
    { NGRX_STATE: SEARCH_STATE },
  )}</script></body></html>`;
  const { document } = parseHTML(html);
  const globals = globalThis as { document?: unknown };
  globals.document = document;
  try {
    const run = new Function(`return (${trademeRecipe.searchScript})()`) as () =>
      unknown;
    const result = run() as unknown[];
    assert.equal(result.length, 2);
  } finally {
    delete globals.document;
  }
});

test("recipe registration and URL matching", () => {
  const listingUrl =
    "https://www.trademe.co.nz/a/property/residential/rent/wellington/x/listing/1";
  const searchUrl =
    "https://www.trademe.co.nz/a/property/residential/rent/wellington/search";
  assert.equal(getRecipeFor(listingUrl)?.id, "trademe");
  assert.equal(getRecipeFor(searchUrl)?.id, "trademe");
  assert.equal(trademeRecipe.isListing(listingUrl), true);
  assert.equal(trademeRecipe.isListing(searchUrl), false);
  assert.equal(isTradeMeListingUrl(listingUrl), true);
});
