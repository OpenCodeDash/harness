# 0002 — Models extract evidence; scoring is deterministic

Status: accepted

## Context

The obvious implementation asks a model to rate each listing "out of 10" against the brief.
That is unreproducible, unexplainable, sensitive to phrasing, and impossible to re-weight
without re-reading every page. The user explicitly needs to change priorities mid-run.

## Decision

Split the work:

- Models (text and vision) produce **structured evidence**: `key`, `value`, `source_type`,
  `source_ref`, `confidence`, `observed_at`.
- A deterministic scorer applies hard filters and weighted soft criteria to that evidence.

Models never produce the final score, never decide a listing "passes," and never see the
ranking when extracting.

## Consequences

- Changing a weight or threshold re-scores the whole campaign in seconds from SQLite.
- Every ranking is explainable per criterion and reproducible from `brief_version_id`.
- Evidence extraction must be schema-validated; invalid output is retried once, then skipped.
- New criteria require re-extraction, not a new prompt to a rater.
- Scoring code is testable without a model.
