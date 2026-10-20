# 0011 — Criteria are brief-owned, compiled from the prompt

Status: accepted

## Context

The first implementation made the domain pack the source of the active criteria:
`pack.defaultCriteria` was a closed list (parking, commute, sunlight, heat pump, condition,
bedrooms). The compiler seeded every default, then overlaid weights for the ones the prompt
mentioned. A request that never mentioned sunlight still scored it at 0.6, and the model
could not add a criterion outside the enum. The pack was doing two jobs: describing what a
source can provide, and deciding what matters.

## Decision

Criteria are **data owned by the brief**. The compiler asks the model for full criterion
specs, not just weights:

- `key`, `label`, `weight`, `kind`
- `normalizer` (boolean preference, lower/higher-is-better, range, enum scores)
- `source`: `field` (pack field), `text` (description prompt), `image` (photo prompt +
  options), or `derived` (`commute`, `price_per_bedroom`, `price_per_bathroom`)
- `origin`: `explicit` or `suggested`
- optional hard predicate (`eq`, `in`, `lte`, `gte`, `range`)
- optional unknown policy and rationale

Rules enforced at compile time:

- Explicit criteria come from the request; suggested ones are the model's additions, marked,
  capped (`MAX_SUGGESTED`), and never hard.
- Suggested criteria always use `unknown: flag`, so a missing fact cannot silently penalise a
  listing the user did not ask to filter.
- `field` sources must exist in the pack. `derived` evaluators must exist in the registry.
  Invalid normalizers, empty prompts, and infeasible sources are dropped with warnings.
- Hard limits come from `hard.*` (domain fields) or a criterion predicate; an unknown hard
  value fails.
- Duplicate keys/labels are merged with explicit beating suggested; totals are capped.
- Legacy briefs with `soft: [{key, weight}]` are migrated to full specs on load and pinned,
  so pack changes cannot alter an old campaign.

The pack now provides capabilities and suggestions: fields, image-feature templates,
suggested criteria, and derived evaluators. The scorer reads `brief.criteria`; it does not
look up a pack. Query templates moved to source integrations later (ADR 0013), and packs
became optional presets with a generic fallback (ADR 0015).

## Consequences

- A prompt can ask for anything the sources can observe: damp, quietness, pets, a view,
  price per bedroom, or a criterion the model invents with a text/image prompt.
- The preview step matters: the user sees explicit vs suggested criteria, can remove or tune
  them, and only then does the run become autonomous.
- Text extraction adds a model call per listing (batched per listing, capped by
  `vision_max`); image extraction now follows the brief rather than a fixed feature list.
- LLM-written prompts are data, not code. The normalizer/evaluator allowlists keep scoring
  deterministic and auditable.
- Cross-domain research still depends on source recipes and packs for structured fields and
  discovery. Criteria flexibility is necessary but not sufficient for "search anything".
- Tests must cover dynamic normalizers, hard predicates, suggested caps, legacy migration,
  text extraction, and prompt-to-criteria golden cases.
