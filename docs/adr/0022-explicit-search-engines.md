# 0022 — Search engines are explicit; site hints are enforced

Status: accepted.

## Context

The SearXNG integration sent queries without an engine list, so the instance used its
default engines. On the deployed instance that effectively meant Google, which now returns
"access denied". The MCP server reports that as a prose message ("Search Degraded: ... google
(access denied)"), which `parseSearchResults` could not parse as JSON and therefore returned
as an empty result. Discovery saw zero hits and stopped with `search-unavailable`, which looked
like "no matching listings" rather than a broken provider.

Separately, a planner query with a `site` hint was only prefixed with `site:<host>`. If an
engine ignored the operator (or returned unrelated results), off-host URLs were still
accepted, which is how unrelated forums and font sites entered a MacBook campaign.

## Decision

- `SearxngMcpProvider` always asks for named engines. Default:
  `brave,bing,yahoo`; override with `SEARXNG_ENGINES` (comma-separated).
- Degraded/failed-engine prose from the MCP is treated as a provider error, not an empty
  result set. The runner records it and reports `search-unavailable` only when every query
  actually returned nothing.
- A planned `site` hint (or a `site:` operator in a template query) is enforced on the
  result host with `matchesHost`. Off-host results are discarded before recipe selection.
- Generic search/collection pages with no structured item list contribute candidate
  `/listing/`, `/product/`, and similar links, which are visited as detail pages. A site
  recipe failure falls back to the generic JSON-LD/HTML recipe.

## Consequences

- One blocked engine no longer zeroes the whole run; the other engines still answer.
- Search outages and access denials are visible in errors instead of masquerading as no
  matches.
- A site-scoped query cannot leak unrelated hosts even if the engine ignores `site:`.
- Link-only search pages can be expanded without a site-specific recipe, at the cost of
  bounded detail visits.
- Engine lists age. They are configuration (`SEARXNG_ENGINES`), not code.
