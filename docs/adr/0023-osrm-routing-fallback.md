# 0023 — OSRM routing fallback when no ORS key is configured

Status: accepted.

## Context

ADR 0006 requires real drive-time routing and forbids a straight-line fallback in the
scoring path. The daemon only constructed the geo service when `ORS_API_KEY` was set. With no
key, a hard derived commute criterion stayed unknown for every listing, so the hard filter
rejected the entire campaign while the run still spent its collection budget.

That is a silent total failure: the campaign looks like it found nothing, when it actually
collected 100 listings and could not score one of them.

## Decision

- Always construct the geo service.
- Use OpenRouteService when `ORS_API_KEY` is set.
- Otherwise use an OSRM router: the public demo by default, or `OSRM_URL` for a self-hosted
  instance.
- OSRM is a real road-network route, not a straight-line estimate, so this stays within
  ADR 0006's intent. It does not add a haversine fallback.
- Route failures still produce an unknown commute, never a guessed value.

## Consequences

- A commute criterion resolves without an ORS subscription.
- The public OSRM demo is rate limited and not a production dependency; set `OSRM_URL` for
  serious use, or add `ORS_API_KEY`.
- A routing outage still surfaces as `commute unknown`, which is now visible because the
  run otherwise evaluates criteria normally.
