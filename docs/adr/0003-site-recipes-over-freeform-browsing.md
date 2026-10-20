# 0003 — Site recipes over freeform browsing

Status: accepted

## Context

An agent can open a listing page and "read" it, but freeform reading is slow, expensive,
non-deterministic, and scales linearly in tokens per listing. Trade Me has hundreds of
listings per search and a DOM that can be parsed exactly.

## Decision

Extraction is a per-site **recipe**: a small function executed inside the page via
chrome-devtools `evaluate_script`, returning structured JSON. Recipes are versioned, matched
by URL pattern, and validate required fields.

The agent browses freeform only for a site that has no recipe, and its output is promoted to a
recipe.

## Consequences

- Per-listing cost is near zero and results are reproducible.
- DOM changes fail loudly (validation error + task), instead of silently producing empty rows.
- Each new site is a bounded piece of work: write a recipe, not a prompt.
- Recipes are code and need tests against saved HTML fixtures.
- Booking/search pages that require complex interaction still need a browser step; recipes
  cover extraction, not authentication or infinite scroll.
