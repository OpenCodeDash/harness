# 0004 — SQLite campaign store + cached media

Status: accepted

## Context

A campaign accumulates listings, per-field evidence, scores, feedback, and run state, and
needs dedupe, re-scoring, and export queries. Append-only JSONL is simple but makes joins,
dedupe, and partial updates awkward. Photos and listings disappear from the source, so the
evidence must be local.

## Decision

One SQLite database per campaign (`campaigns/<slug>/campaign.db`) plus a `media/` directory
of cached images keyed by content hash. SQLite holds brief versions, listings, evidence,
scores, feedback, runs, and media references.

CSV/XLSX are generated exports, never inputs.

## Consequences

- One file per campaign, portable and easy to back up.
- Scores are versioned by brief, so old rankings remain reproducible.
- `run.cursor` makes pause/resume and crash recovery trivial.
- Concurrency is limited to one writer; that matches the single-runner design.
- Cached media grows; needs a retention policy per campaign.
- Fuzzy dedupe and full-text search can be added without changing the storage model.
