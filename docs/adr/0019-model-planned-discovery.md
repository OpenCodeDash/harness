# 0019 — Plan discovery queries with the model

Status: accepted.

## Context

Discovery built queries by substituting brief values into a handful of source templates.
The open-web template was `{prompt}`, so the actual query was the full request sentence;
`keywords` concatenated criterion labels. Search engines return nothing useful for a long
sentence, and the results that did come back were whatever category pages happened to match.
Templates were also gated by a domain label, so a brief without a preset only ever ran the
raw-prompt query.

Templates are still useful as a deterministic fallback and as documentation of a source's
capabilities, but they cannot turn a request into several short, different searches.

## Decision

Plan queries with one schema-constrained model call before discovery.

- `QueryPlanner` takes the brief and the active sources and returns 1–8 `{ query, site? }`
  entries. Queries are short phrases (3–12 words), varied by angle, and never contain
  placeholders or braces.
- `site` is a bare host and is only honoured when it belongs to a registered source. An
  unknown host is dropped and the query is kept; the `site:` operator is never authored by
  the model.
- `validatePlannedQueries` enforces length, dedupe, host allow-listing, and the query cap.
  Invalid output is discarded rather than repaired silently.
- The planner is optional. If it is unavailable, errors, or returns nothing, the runner falls
  back to source templates. Templates are no longer gated by a domain label; they are gated
  only by the values they require.
- Discovery records per-query hit counts. If every query returns zero results the run stops
  with `search-unavailable`; if results exist but none pass a recipe or the source policy it
  stops with `no-listing-pages`. Both are surfaced as warnings in the summary.

## Consequences

- A prompt becomes several natural searches instead of one long sentence.
- Source integrations still own their templates, but the model owns query shape.
- One extra model call per run (cheap, bounded output). A planner failure degrades to the
  previous behaviour rather than failing the run.
- Empty or unusable search results are now distinguishable from "no matching listings",
  which makes search-backend failures visible.
- Query quality is observable: hit counts and accepted-seed counts appear in the run log.
