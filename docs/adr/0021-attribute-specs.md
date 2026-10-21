# 0021 — Attribute extraction through specs

Status: accepted.

## Context

Removing packs (ADR 0017) left field criteria with no way to reach attributes that are not
in the canonical vocabulary. A brief could ask for `ram_gb >= 16`, but nothing extracted
`ram_gb`, so the criterion was permanently unknown and a hard filter always failed. Site
state and spec tables already contain the data (Trade Me exposes `Memory: 16 to 31 GB`,
`Brand: Apple`; JSON-LD exposes `additionalProperty`; many pages have `<dl>` or two-column
tables), but the harness only stored the canonical fields.

Adding a field to a pack would reintroduce the preset problem, and adding every possible
attribute to the canonical vocabulary does not scale.

## Decision

Treat attributes as first-class specs and resolve field criteria against them.

- Extractors emit an optional `specs` map of arbitrary key/value attributes:
  - JSON-LD `additionalProperty` (`PropertyValue.name`/`value`);
  - site state attributes (Trade Me detail attributes);
  - generic HTML `<dl>` pairs and two-column table rows.
- At ingest, specs are flattened into normalised evidence keys (e.g. `ram_size`, `memory`)
  in addition to the `specs` object. Explicit fields win over a spec with the same key.
- A field criterion resolves in this order: exact evidence key, unit alias
  (`ram_gb` → `memory`/`ram_size`), then a conservative unit-stripped fuzzy match.
  `src/domain/specs.ts` owns the alias and normalisation rules.
- Number normalisation parses the first numeric value and strips thousands separators, so
  `"16 to 31 GB"` reads as `16` and `"1,999"` as `1999`.
- The compiler may emit any field key. It is told that spec keys such as `ram_gb` are read
  from structured data and spec tables, and to use a text criterion when a value is only
  stated in prose.

## Consequences

- A hard `ram_gb >= 16` criterion can pass from a Trade Me spec table or JSON-LD without a
  laptop preset.
- Arbitrary attributes are stored with provenance and are visible in the campaign database.
- Alias matching is intentionally small and conservative. An unrecognised key becomes a
  gap, never a wrong match; adding an alias is a one-line change, not a new pack.
- Range strings resolve to their lower bound. That is conservative for "16 to 31 GB" but
  would understate a range whose lower bound is below a threshold; the raw string remains
  available in evidence.
