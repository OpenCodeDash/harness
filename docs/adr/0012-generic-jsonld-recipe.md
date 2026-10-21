# 0012 — Generic JSON-LD source recipe

Status: accepted

## Context

Dynamic criteria removed the fixed criteria enum, but discovery and extraction still only
observed Trade Me property listings. A prompt about cars, laptops, or a non-Trade-Me site
compiled fine and then found nothing, because `getRecipeFor` rejected every other URL and the
only registered recipe matched Trade Me rental pages. "Search anything" was limited by
sources, not by criteria (ADR 0011).

Many listing sites already publish machine-readable `schema.org` JSON-LD for search engines:
`Product` with `offers`, `Vehicle`, `RealEstateListing`, and `ItemList` of the above. Reading
that data is structured extraction, not universal HTML scraping.

## Decision

Add a **generic JSON-LD recipe** with the lowest priority in the registry:

- It matches any HTTP(S) URL that is not an obvious non-HTML asset (PDF, image, archive).
- Site recipes keep priority; the generic recipe only handles URLs no specific recipe claims.
- It flattens `@graph`, `ItemList`, and list-item wrappers, ranks listing entities
  (`Product`, `Vehicle`, `RealEstateListing`, `Offer`, …), and skips site chrome
  (`WebSite`, `Organization`, `BreadcrumbList`, `WebPage`, `Article`).
- It maps a stable, pack-agnostic field set: `title`, `description`, `price`, `currency`,
  `brand`, `model`, `year`, `mileage`, `condition`, `color`, `address`, `location`, `lat`,
  `lon`, `availability`, `seller`, plus images.
- It never guesses from free HTML. A page without usable JSON-LD returns no listing and fails
  validation loudly, exactly like a drifted site recipe.
- Discovery query templates are source-aware. A template may name the recipe it feeds and a
  `site:` restriction; discovery skips it when that recipe is not registered, and generic
  templates use the brief prompt, area, price limit, and hard field values instead of
  property-only placeholders.

## Consequences

- Cars and laptops can be researched through any site that publishes JSON-LD; ship `cars` and
  `laptops` packs with fields that match the generic mapping.
- The generic recipe is a fallback, not a replacement. Sites with unusual markup still need a
  dedicated recipe, and the propose-a-recipe path remains.
- Cross-domain hard limits belong on criterion predicates (`price lte 15000`); the property
  `rent_max`/`bedrooms` fields remain property-only.
- Dedupe is per source id (`jsonld`), so the same item found through a site recipe and the
  generic fallback can appear twice until fuzzy clustering lands.
- Sites that ship misleading structured data will produce misleading evidence; provenance
  points at the page and the JSON-LD entity, so it is auditable.
