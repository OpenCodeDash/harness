# 0018 — Classify pages at runtime, expand indexes

Status: accepted.

## Context

The generic JSON-LD recipe declared `isListing: () => true` because it could not know a
site's URL shape. The runner therefore treated every discovered URL as one listing: a Trade
Me search page or a retailer collection became a single row carrying an aggregate price, and
the detail-follow path was unreachable for generic sources. Category pages could never pass a
hard filter, so a run could collect pages and still score zero.

URL heuristics do not generalise across sites. A path may contain `/listing/`, `/product/`,
`/p/`, or nothing at all, and the same site can use a different shape per category.

## Decision

Decide the page kind from what the page contains, not from its URL.

- A recipe may still assert `isListing(url)` when it owns the site and the URL shape is
  stable (Trade Me `/listing/<id>`).
- Otherwise the runner extracts every listing the page publishes (JSON-LD entities,
  `ItemList` elements, site state) and classifies:
  - if any extracted item points at a URL other than the page, it is an **index**;
  - if all items point at the page and there is more than one, it is still an **index**;
  - if there is at most one item and it points at the page, it is a **listing**;
  - no items is a loud collection error, not an empty listing.
- Index pages ingest their extracted items and then visit item URLs as detail pages, bounded
  by `detailLimit`. The index URL itself is never ingested as a listing.
- Detail extraction for the generic recipe prefers the entity whose URL matches the page, so
  related-product JSON-LD cannot replace the item being viewed.
- Site recipes that expose the site's own listing state (Trade Me) are matched for every
  listing and search URL on that host, not only one category, and emit generic fields
  (`title`, `price`, `location`, `brand`, `model`, `specs`) alongside any site-specific ones.

## Consequences

- A generic source can now turn a search or collection page into many real listings without a
  per-site recipe.
- The runner no longer needs a domain label to know what a page is.
- Crawling is bounded: one seed can yield at most `detailLimit` detail visits, and the listing
  budget still caps ingestion.
- A page with no extractable listings fails loudly instead of producing a phantom row.
- Site recipes remain valuable for authenticated or stateful sites, but they are not required
  to make discovery useful.
