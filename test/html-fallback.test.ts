import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import {
  extractFallbackListing,
  jsonLdRecipe,
} from "../src/sources/jsonld.ts";

function documentFor(html: string): Document {
  return parseHTML(html).document as unknown as Document;
}

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

const PAGE_URL = "https://shop.test/items/42";

const HTML = `<!doctype html>
<html>
  <head>
    <title>Vintage road bike</title>
    <meta name="description" content="Steel frame, recently serviced." />
    <meta property="og:image" content="/img/bike.jpg" />
    <link rel="canonical" href="/listing/42" />
  </head>
  <body>
    <main>
      <h1>Vintage road bike</h1>
      <p>Only $1,250. Great condition, new tyres.</p>
    </main>
    <footer>Shop footer</footer>
  </body>
</html>`;

test("extracts title, description, price, canonical URL, and image", () => {
  const listing = extractFallbackListing(
    documentFor(HTML),
    PAGE_URL,
  ) as {
    externalId: string;
    url: string;
    fields: Record<string, unknown>;
    media: string[];
    sourceRef: string;
    confidence: number;
    fallback: boolean;
  };

  assert.equal(listing.externalId, "42");
  assert.equal(listing.url, "https://shop.test/listing/42");
  assert.equal(listing.fields.title, "Vintage road bike");
  assert.equal(listing.fields.description, "Steel frame, recently serviced.");
  assert.equal(listing.fields.price, 1250);
  assert.deepEqual(listing.media, ["https://shop.test/img/bike.jpg"]);
  assert.equal(listing.sourceRef, "generic:html");
  assert.ok(listing.confidence < 1);
  assert.equal(listing.fallback, true);
});

test("falls back to body text and an obvious price without metadata", () => {
  const html = `<html><head><title>Desk</title></head><body><main>
    <h1>Solid oak desk</h1>
    <p>Asking $2,000 or nearest offer. Pickup only.</p>
  </main></body></html>`;
  const listing = extractFallbackListing(documentFor(html), PAGE_URL) as {
    fields: Record<string, unknown>;
    media: string[];
  };
  assert.equal(listing.fields.title, "Solid oak desk");
  assert.match(String(listing.fields.description), /Solid oak desk/);
  assert.equal(listing.fields.price, 2000);
  assert.deepEqual(listing.media, []);
});

test("pages with no usable content return null", () => {
  const html = "<html><head></head><body><nav>Menu</nav></body></html>";
  assert.equal(extractFallbackListing(documentFor(html), PAGE_URL), null);
});

test("the recipe uses HTML fallback only when JSON-LD is absent", () => {
  const fallback = runScript(jsonLdRecipe.listingScript, HTML, PAGE_URL) as {
    sourceRef: string;
    fallback: boolean;
  };
  assert.equal(fallback.sourceRef, "generic:html");
  assert.equal(fallback.fallback, true);

  const jsonLd = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    name: "Structured bike",
    sku: "BIKE-1",
    offers: { price: 900 },
  })}</script></head><body></body></html>`;
  const structured = runScript(
    jsonLdRecipe.listingScript,
    jsonLd,
    PAGE_URL,
  ) as { externalId: string; fallback?: boolean };
  assert.equal(structured.externalId, "BIKE-1");
  assert.equal(structured.fallback, undefined);
});

test("extracts specs from definition lists and two-column tables", () => {
  const html = `<html><head><title>MacBook</title></head><body><main>
    <h1>MacBook Pro</h1>
    <p>Great condition, $2,000.</p>
    <dl>
      <dt>RAM Size</dt><dd>16GB</dd>
      <dt>Storage</dt><dd>512GB</dd>
    </dl>
    <table>
      <tr><th>Battery Health</th><td>90%</td></tr>
    </table>
  </main></body></html>`;
  const listing = extractFallbackListing(documentFor(html), PAGE_URL) as {
    fields: Record<string, unknown>;
  };
  assert.deepEqual(listing.fields.specs, {
    ram_size: "16GB",
    storage: "512GB",
    battery_health: "90%",
  });
});

test("extracts label/value lines and bullet specs from page text", () => {
  const html = `<html><head><title>MacBook</title></head><body><main>
    <h1>MacBook Air</h1>
    <p>A nice laptop for $2,000.</p>
    <div>Details</div>
    <div>Condition:</div>
    <div>Used</div>
    <div>Memory:</div>
    <div>32 GB &amp; over</div>
    <div>Specifications:</div>
    <div>🔋 Battery health: 93% maximum capacity</div>
  </main></body></html>`;
  const listing = extractFallbackListing(documentFor(html), PAGE_URL) as {
    fields: Record<string, unknown>;
  };
  const specs = listing.fields.specs as Record<string, string>;
  assert.equal(specs.condition, "Used");
  assert.equal(specs.memory, "32 GB & over");
  assert.equal(specs.battery_health, "93% maximum capacity");
});
