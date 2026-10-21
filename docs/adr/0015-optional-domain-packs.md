# 0015 — Domain packs are optional presets

Status: superseded by [0017](0017-remove-domain-packs.md)

## Context

Packs began as the source of the active criteria and later became domain presets (ADR 0011).
They still gated the runtime: `getPack` threw on an unknown id, the CLI and daemon always
resolved a pack, and YAML field validation only knew the selected pack's fields. That made
"search anything" require authoring a pack first, even though the generic JSON-LD source
already emits a stable canonical field set and criteria are brief-owned.

## Decision

Add a **generic pack** and make every pack optional:

- The generic pack defines the canonical vocabulary emitted by the JSON-LD source: `title`,
  `description`, `price`, `currency`, `brand`, `model`, `year`, `mileage`, `condition`,
  `color`, `address`, `location`, `lat`, `lon`, `availability`, `seller`.
- `allFields(pack)` returns the generic fields plus the pack's fields, with the pack winning
  on duplicate keys. Field-source validation and the brief compiler prompt use this union, so
  a property brief may still ask for `price` or `title`, and a car brief may still ask for
  `location`.
- `getPack(id?)` resolves a preset and returns the generic pack for an unknown or missing id.
  `findPack(id)` is the strict lookup for callers that need to distinguish a preset.
- CLI and daemon keep `property` as their default preset for backwards compatibility, but an
  unknown `--pack` or `pack` value now falls back to generic instead of failing the run.
- Legacy `soft` briefs migrate with the selected pack; with no pack they migrate against the
  generic pack and warn about unknown keys instead of throwing.
- The daemon passes the campaign's pack to `parseBrief` on reopen, so persisted field criteria
  are validated against the same vocabulary they were created with.
- The generic pack's default criteria are only `price` and `condition`; they are suggestions,
  not a domain model. Rich suggestions remain the job of property/cars/laptops presets.

## Consequences

- A prompt about an unknown domain runs without writing a pack: generic fields plus brief
  text/image criteria.
- Packs become quality presets: better fields, aliases, image prompts, and suggestions.
- Adding a pack no longer changes the minimum viable path for a new domain.
- Suggestion quality for unknown domains is lower until a pack exists; the preview shows the
  generic criteria and the user can tune them.
- Legacy `soft` briefs with unknown keys may lose criteria with a warning instead of failing
  to load.
- UIs can list the generic preset alongside domain presets.
