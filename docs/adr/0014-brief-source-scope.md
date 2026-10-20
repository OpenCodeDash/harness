# 0014 — Open web by default, brief-scoped sources

Status: accepted

## Context

Source integrations and discovery moved onto the source registry (ADR 0013), but nothing
decided *which* sources a run may use. The product goal is "search anything": popular-site
integrations should be strong, but the harness should go outside them unless the brief says
otherwise. A default allowlist would invert that goal; an unconditional open web would ignore
a user who says "Trade Me only" or "no Facebook".

## Decision

The brief owns source scope:

```yaml
sources:
  web: open            # open | structured-only | off
  allow: [trademe]     # optional; source ids or hosts
  deny: [facebook.com] # optional; source ids or hosts
  prefer: [trademe]    # optional; query order only
```

Rules:

- `web: open` (default) searches every registered source.
- `web: structured-only` skips sources whose discovery kind is `html` (the generic scraper
  fallback); site recipes and JSON-LD still run.
- `web: off` searches only explicitly allowed sources. With no `allow` list, discovery runs
  nothing.
- `allow` and `deny` match a source id (`trademe`) or a host (`trademe.co.nz`, including
  subdomains). `deny` wins over `allow`.
- `prefer` only sorts sources so their queries run first; it never excludes anything.
- Enforcement happens twice: source selection filters which sources contribute queries, and
  URL admission checks each discovered result against the scope and the recipe that will
  parse it. This prevents an allowed source's search results from leaking URLs from a denied
  site, and lets an allow-listed site still be parsed by the generic fallback.
- The scope is normalised (lowercase, deduplicated) and echoed as a brief assumption plus a
  `Sources:` line. Unknown allow/deny entries produce warnings rather than failures.
- The compiler defaults to open web and only emits a source scope when the prompt names sites
  or limits the search.

## Consequences

- "Search anything" is the default; restricting discovery is an explicit, visible brief
  decision.
- A brief can express "Trade Me and nowhere else" as `web: off` + `allow: [trademe]`.
- A brief can exclude a noisy site without locking everything else down.
- Result admission depends on the winning recipe, so a denied host cannot sneak back in via
  the generic JSON-LD fallback.
- Future source metadata (rate limits, auth, detail policy) can be filtered by the same scope.
- Feedback deltas do not yet edit source scope; changing it currently means a new brief
  version.
