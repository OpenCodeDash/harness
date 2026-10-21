# 0017 — Remove domain packs

Status: accepted. Supersedes [0015](0015-optional-domain-packs.md).

## Context

ADR 0015 made packs optional but kept them in the runtime: `getPack` selected a preset,
field validation used the preset's field list, the compiler prompt named the preset, and the
daemon stored a `pack` column. In practice a run without a pack lost fields, suggestions, and
domain-gated query templates, so "just ask for something" still required authoring or picking
a pack. The preset also leaked into scoring and export signatures even though scoring never
used it.

The remaining value of a pack — aliases, suggested criteria, image prompts, field names — is
knowledge the compiler can author per request. Keeping presets meant maintaining a second,
parallel domain model that could disagree with the brief.

## Decision

Delete the pack concept from the runtime.

- `src/domain/fields.ts` holds one canonical field vocabulary (`FIELDS`) with aliases. It is
  used by extraction, field resolution, and the compiler prompt, but it is not a preset and
  not a gate. A criterion may name any field key; an unknown key is simply unresolved
  evidence.
- Suggested criteria and image prompts are authored by the compiler. There are no
  `defaultCriteria` or `imageFeatures` presets. If extraction returns no criteria, the
  fallback is the two core suggestions (`price`, `condition`).
- `getPack`, `findPack`, `listPacks`, `DomainPack`, the `--pack` flag, the daemon `pack`
  option, and the registry `pack` column are removed. Existing registries drop the legacy
  column on open.
- Compile, parse, feedback, scoring, export, and the runner no longer take a pack argument.
- `soft` briefs from before ADR 0011 migrate only for core keys (`price`, `condition`);
  anything else is dropped with a warning instead of being resolved through a preset.

## Consequences

- A prompt compiles and runs with no domain input. "Search anything" no longer has a
  quality cliff for unknown domains.
- One vocabulary to maintain. Field names used by a brief are either extracted or become
  gaps; there is no second list to keep in sync.
- Suggestion quality now depends entirely on the compiler prompt. If it regresses, that is
  visible in the preview rather than hidden behind a preset.
- Legacy `soft` briefs lose non-core criteria on load. Persisted briefs from ADR 0011 onward
  carry full criteria and are unaffected.
- Source recipes still understand site structure, but they must emit generic fields and must
  not be selected by a domain label.
