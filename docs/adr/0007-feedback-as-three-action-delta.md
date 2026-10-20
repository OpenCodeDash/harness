# 0007 — Feedback is a delta with three actions

Status: accepted

## Context

The user wants to interrupt a run and say things like "I don't care about sunlight", "also
check for mould", or "you missed townhouses". These are different kinds of request, and
treating them all as "re-run everything" is slow, expensive, and loses trust.

## Decision

Classify every piece of feedback into exactly one action:

- `re-score` — a weight, preference, or soft threshold changed.
- `re-extract` — a new feature to look for in existing listings.
- `re-search` — a coverage complaint, new area, or new source.

Append the parsed delta to the brief, apply it at the next step boundary, and report the
interpretation plus the effect. Fine-grained matching of "which deltas can apply at once" is
not required in v1.

## Consequences

- Most feedback is answered in seconds without touching the browser.
- The user can correct a misread with a follow-up instead of restarting.
- Feedback is durable and auditable; every score version traces to brief versions.
- Classification can be wrong; the reported interpretation is the safety net.
- Some feedback is genuinely ambiguous ("cheaper") and must be turned into a concrete delta
  or asked about, not guessed silently.
