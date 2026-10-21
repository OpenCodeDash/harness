# 0020 — Seeds and model-interpreted feedback

Status: accepted.

## Context

Two gaps kept the brief from expressing what a user actually meant.

1. There was no way to hand the runner a known URL. The only entry point was discovery,
   so "start from this listing" could not be expressed, and `CampaignOptions.seedUrls`
   existed but was unused.
2. Feedback was a hand-written regex parser (`feedback/interpret.ts`). It understood weight
   words, rent, bedrooms, areas, and a few property fields. It could not express "only
   trademe.co.nz", "start from this URL", or a new criterion, even though `BriefDelta`
   already had `queries` and `addCriteria`.

## Decision

### Seeds and explicit queries live on the brief

- `Brief.seeds` holds http(s) URLs. When present, the runner collects them directly and
  skips discovery. `CampaignOptions.seedUrls` still overrides them for a one-off run.
- `Brief.queries` holds extra search phrases. Discovery runs them before planner output and
  templates.
- The compiler extracts full URLs from the prompt and detects "only from <host>" / "<host>
  only" phrases. An only-site phrase becomes `sources.allow: [host]` with `web: off`, not a
  soft preference.
- Seeds and queries are serialized, echoed as assumptions, and preserved by feedback deltas.

### Feedback is interpreted by the model, with the regex parser as fallback

- `FeedbackInterpreter` sends the feedback plus the current brief to one schema-constrained
  model call and receives a `BriefDelta`.
- `BriefDelta` gains `sources`, `seeds`, `removeSeeds`, and keeps `queries`. Source and seed
  changes force `re-search`; added criteria force `re-extract`.
- `applyFeedbackWithInterpreter` uses the model result when it is valid and changes
  something, otherwise falls back to the deterministic parser. A model outage degrades
  instead of failing the request.
- The deterministic parser remains the fast path for simple weight and limit changes and is
  covered by its own tests.

## Consequences

- "Only trademe.co.nz" now actually excludes other hosts, and "start from this URL" works.
- Feedback can add a criterion, change source scope, add seeds or queries, or adjust weights
  without a new campaign.
- One model call per feedback message, bounded by a strict schema. Invalid output is
  discarded and the regex path runs.
- The brief grows two optional arrays. Existing briefs load with empty seeds/queries.
