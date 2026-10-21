# 0013 — Source integrations own discovery

Status: accepted

## Context

Packs started as the only place a query could be described. Each pack carried
`queryTemplates`, and discovery rendered them for every brief of that pack. That made packs do
two unrelated jobs: describe a domain (fields, suggestions, image prompts) and describe how to
search a particular site. It also meant a new source integration had to edit every pack, and a
pack could generate queries for a source that was not registered.

The product direction is open-web by default with strong integrations for popular sites such
as Trade Me. Packs should be optional domain presets; sources should decide where and how to
search.

## Decision

Discovery metadata lives on the **source integration**, next to its recipe:

```ts
interface Recipe {
  id: string;
  discovery?: {
    label: string;
    sites?: string[];
    queryTemplates?: Array<{
      template: string;
      domains?: string[];   // pack/domain ids this template fits
      requires?: string[];  // placeholders that must be non-empty
      site?: string;        // search-engine site: restriction
    }>;
  };
}
```

- `buildDiscoveryQueries(brief, sources)` walks the registered sources only. No pack is
  involved.
- Templates without `domains` apply to every brief; templates with `domains` run only when the
  brief's domain matches. This keeps Trade Me property queries out of a laptop run without
  making packs mandatory.
- `requires` prevents degenerate queries such as a bare `site:trademe.co.nz/motors` when the
  brief has no make, model, or area.
- A source can expose generic `{ prompt }` templates as well as domain-specific ones, so a
  Trade Me integration still contributes to an unusual brief.
- Packs no longer have `queryTemplates`. They keep fields, aliases, image-feature templates,
  suggested criteria, and defaults.
- The source registry (`listRecipes`) is the single origin for discovery and extraction, so a
  query can only be generated for a source the runner can actually parse.

## Consequences

- Adding a site integration is one file: recipe plus discovery metadata. No pack edits.
- Source-specific strengths (Trade Me property paths, motors, computers) can be encoded
  without weakening open-web discovery.
- Domain hints still matter, but they are hints. A brief with an unknown domain gets only
  domain-agnostic source templates, plus later the generic source policy work.
- Rate limits, detail-visit policy, and auth remain future source metadata; this ADR only
  moves query ownership.
- Discovery order follows registration order, so popular integrations can be queried first
  without a separate preference list.
