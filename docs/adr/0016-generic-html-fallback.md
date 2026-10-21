# 0016 — Generic HTML text fallback

Status: accepted

## Context

The generic JSON-LD source (ADR 0012) made open-web discovery possible, but only for pages
that publish structured data. Many listing pages do not. Falling back to the propose-a-recipe
path costs a model call per site and only works after a site is seen once. For open-ended
research, a cheap last resort is better than a hard failure.

Reading arbitrary HTML is risky: it is noisy, easy to scrape into junk, and can contain
untrusted instructions. It must not silently become equal-quality evidence.

## Decision

The generic web source gets a **text fallback** that runs only when JSON-LD is absent:

- Extract standard, low-risk signals: `og:title`/`twitter:title`/`h1`/`document.title`, meta
  description or main text (bounded), canonical URL, an obvious currency-prefixed price, and
  `og:image`/`twitter:image`.
- Mark the listing with `sourceRef: "generic:html"`, `confidence: 0.5`, and `fallback: true`.
  Evidence ingestion uses that provenance and confidence instead of the recipe's default.
- Require a minimum signal (price, or a title with enough description, or substantial body
  text). Otherwise return nothing and fail validation loudly.
- Treat the extracted text as untrusted data. It flows through the existing delimited text
  extractor, never into a freeform agent.
- Budget-gate fallbacks with `budgets.html_max` (default 25). The runner counts each accepted
  HTML fallback, including detail-visit fallbacks, and checkpoints the count in the run cursor
  so resume does not reset it. Over-budget fallbacks are skipped with a log line.
- Under `sources.web: structured-only`, discard HTML fallbacks even though they come from the
  generic source (ADR 0014). Open and off/allow modes keep them.
- Site recipes and JSON-LD always win; the fallback only runs when structured extraction
  produced no listing.

## Consequences

- Non-JSON-LD pages can contribute title/description/price without a per-site recipe.
- Evidence is visibly lower-confidence and provenance-tagged, so ranking and debugging can
  distinguish it from structured data.
- Long-tail pages are capped; a run cannot spend its whole budget on generic HTML scraps.
- Extraction is heuristic: prices may be wrong, descriptions may include navigation text, and
  images may be logos. The confidence and budget are the guardrails, not a guarantee.
- Prompt-injection risk is bounded by delimited text extraction, but HTML text remains
  untrusted and must stay that way.
- A future readability library or per-site recipe can replace the heuristic without changing
  the evidence model.
