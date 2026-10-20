# 0006 — Drive-time routing from v1

Status: accepted

## Context

"Near my work" is one of the most common and most consequential criteria. A straight-line
radius systematically mis-ranks cities with water, hills, and motorways — Wellington among
them. Adding routing later would change the results of every saved campaign.

## Decision

Use real drive-time routing from the first version, behind a `RoutingProvider` interface.
OpenRouteService is the v1 implementation. There is no straight-line fallback inside the
scoring path.

Cache routes per `(origin, dest)` with `observed_at`, and store `drive_min` on the listing.
Geocode with a provider (Nominatim or LINZ), cache by normalized address, and put unresolved
addresses in an `unmatched` bucket.

## Consequences

- Commute scores are meaningful from day one and comparable across runs.
- An API key and network dependency enter the run; failures must degrade to "unknown" and be
  reported, not guessed.
- Providers differ on traffic modeling; the interface must record which provider produced a
  duration.
- Coordinates leave the machine to the routing provider. Keep anchors local and send only the
  minimum required.
