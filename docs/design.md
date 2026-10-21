# Design

Status: draft. Decisions live in [`adr/`](adr/README.md); this document describes the system
those decisions produce.

## 1. Problem

Open-ended research is mostly a loop of *find, record, judge, refine*. Doing it by hand across
rentals, cars, or laptops is slow and forgetful: you lose listings, you can't re-rank when your
priorities change, and you can't tell what you never found out.

This harness runs that loop autonomously from a single brief, keeps every observation, and
stays steerable while it runs.

## 2. Goals

- One prompt → an autonomous run: discover, collect, extract, score, export.
- Rate listings against **weighted, user-specific requirements**, explainably.
- Use **image evidence** for things listings don't say (heat pump, sunlight, condition).
- Accept interruption and feedback at any time; re-score or re-search without a full rerun.
- Work for any listing-shaped research from the prompt alone; no domain preset required.
- Leave a durable, auditable record of what was seen, when, and from where.

## 3. Non-goals

- Not a coding agent: no git verification, no PR/merge loop, no reviewer role.
- Not multi-tenant: no containers, no isolation, no credential broker (ADR 0001).
- Not a general scraper: extraction is per-site recipes, with a JSON-LD fallback for sites
  that publish structured data (ADR 0012).
- Not a valuation or prediction engine: it ranks observable evidence, it does not price assets.
- Not scheduled: runs are on demand in v1.
- Not a live spreadsheet: export is a read-only view (ADR 0008).

## 4. Principles

1. **Durable state lives outside the model.** The run must survive a crash, a pause, and a
   context reset. Anything not written down is lost.
2. **Evidence first, scoring second.** Models extract facts with provenance; a deterministic
   scorer turns facts into a ranking. Never ask a model for a rating (ADR 0002).
3. **Unknown is not absent.** Missing evidence is a gap to report or resolve, not a zero.
4. **Feedback is a delta, not a rerun** (ADR 0007).
5. **Exports are views.** The campaign database is the source of truth.
6. **Source drift fails loudly.** A changed DOM must produce an error, not silently empty
   results (ADR 0003).

## 5. Architecture

```
┌────────────────┐  campaign_* tools  ┌──────────────────────────────┐
│ chat (opencode)│───────────────────►│ runner (custom TS process)   │
│ optional UI    │                    │ owns loop, state, budgets    │
└────────────────┘                    └───┬───────┬───────┬──────────┘
                                          │       │       │
                        ┌─────────────────▼─┐ ┌───▼────┐ ┌▼───────────────┐
                        │ SQLite + media/   │ │ SearXNG│ │ chrome-devtools│
                        │ exports/          │ │ HTTP   │ │ MCP client     │
                        └───────────────────┘ └────────┘ └────────────────┘
                                          │
                                          └─► router /v1/responses
                                              (one-shot extract + vision)
```

- **Runner** — a plain TypeScript process and the only writer. Owns the state machine,
  checkpoint cursor, budgets, pause flag, dedupe, scoring, and exports. No agent framework.
- **Collector** — deterministic steps, not sessions: navigate, run a site recipe in the page,
  validate, store. The model is not on this path.
- **Model calls** — one-shot and schema-constrained: description extraction, vision, query
  planning, and (at development time) authoring or repairing recipes. Never a multi-turn
  browsing agent.
- **Sources** — SearXNG over HTTP; chrome-devtools through an MCP client (the same server
  opencode uses, called by the harness).
- **Chat** — optional. opencode is only the UI where you type feedback; it calls runner tools.
  The harness does not depend on it and can ship its own CLI later.
- **Store** — one SQLite file per campaign plus a media directory (ADR 0004).
- **Geo** — geocoding and drive-time routing behind a provider interface (ADR 0006).

No opencode or agent framework in the runtime: see ADR 0010. Collection is deterministic, so
context growth and session lifecycle are not failure modes.

## 6. Run lifecycle

```
brief ─► discover ─► collect ─► extract ─► filter ─► vision ─► score ─► export ─► idle
           ▲            │                                                  │
           └──── feedback: re-search ◄─────────────────────────────────────┘
```

- A **batch** is at most 5 listings or one results page. The runner checkpoints the cursor
  after every batch.
- **Pause** sets a flag; the in-flight batch finishes, then the run stops cleanly at the next
  boundary. `kill -9` loses at most one batch.
- **Resume** reads the cursor and continues. It never restarts from zero.
- **Re-score / re-extract** are separate, cheap sub-loops that do not re-enter discovery.
- One active run per campaign. Multiple campaigns may exist; they run one at a time.

## 7. Brief

The brief is versioned YAML, compiled from the initial prompt and amended by feedback.

Criteria are **brief-owned data**. The compiler extracts explicit
criteria from the request and proposes suggested ones; every criterion carries its own
evaluation spec.

```yaml
version: 3
domain: property
prompt: "2-3 bed rental in Wellington under $650, near my work in the CBD, want a carpark"
anchors:
  work: { address: "Wellington CBD" }
  commute: { mode: drive, max_minutes: 25, hard: false }
hard:
  rent_max: 650
  bedrooms: { min: 2, max: 3 }
  areas: [Wellington]
criteria:
  - key: parking
    label: Parking
    weight: 0.9
    kind: boolean
    normalizer: { type: boolean }
    source: { type: field, field: parking }
    origin: explicit
    hard: { op: eq, value: true }
  - key: commute_to_work
    label: Commute to work
    weight: 0.8
    kind: number
    normalizer: { type: lower-is-better, max: 45 }
    source: { type: derived, evaluator: commute }
    origin: explicit
  - key: damp_or_mould
    label: Damp or mould
    weight: 0.5
    kind: boolean
    normalizer: { type: boolean, prefer: false }
    source: { type: image, prompt: "Any visible damp or mould in the photos?" }
    origin: suggested
    rationale: "common in older rentals"
  - key: quietness
    label: Quiet
    weight: 0.6
    kind: boolean
    normalizer: { type: boolean }
    source: { type: text, prompt: "Is the home described as quiet?" }
    origin: explicit
unknown_policy: flag          # flag | penalize | investigate
sources:
  web: open                   # open | structured-only | off
  allow: [trademe]            # optional; source ids or hosts
  deny: []                    # optional
  prefer: [trademe]           # optional; query order only
budgets:
  max_listings: 300
  max_usd: 15
  max_minutes: 120
  vision_max: 60
  html_max: 25
assumptions:
  - "near work means <=25 min drive in light traffic"
warnings: []
```

Rules:

- `source` is one of `field`, `text`, `image`, or `derived`. `field` names a key in the
  canonical field vocabulary or an extracted spec; derived evaluators are `commute`,
  `price_per_bedroom`, and `price_per_bathroom`; text and image prompts are extraction
  instructions for the model.
- Normalizers encode preference: `boolean prefer: false` makes a bad thing (damp, mould)
  score well when absent.
- Explicit criteria come from the user. Suggested criteria are marked, lower-weighted by
  default, capped, and must not carry hard constraints; their unknowns are flagged.
- Hard limits live either in `hard.*` (domain fields) or as a criterion predicate
  (`hard: { op: eq|lte|gte|range|in, ... }`).
- **Sources are open by default.** `sources.web: open` searches every registered source.
  `structured-only` skips generic HTML extraction; `off` searches only explicitly allowed
  sources (and searches nothing when `allow` is empty). `allow`/`deny` take source ids or
  hosts and are enforced both when building queries and when accepting result URLs.
  `prefer` only changes query order. The scope is echoed as an assumption and in the brief
  echo (ADR 0014).
- Compile → **preview**: the UI shows explicit and suggested criteria, weights, sources, and
  warnings. The user removes or tunes suggestions, then starts; after that the run is
  autonomous.
- Legacy briefs with `soft: [{ key, weight }]` migrate to full criteria on load and are
  pinned, so later compiler changes cannot alter an old campaign.
- Warnings record dropped criteria, cap trims, and invalid specs; they are surfaced in the
  preview and the brief echo.

## 8. Evidence model

A listing is a set of claims, each with provenance:

| field | meaning |
| --- | --- |
| `key` | `carpark`, `heat_pump`, `sunlight`, `rent`, `bedrooms`, `drive_min`, … |
| `value` | scalar or enum |
| `source_type` | `page` \| `image` \| `inference` \| `user` |
| `source_ref` | recipe id, image hash, or feedback id |
| `confidence` | 0–1 |
| `observed_at` | when the evidence was true, not when it was scored |

Derived values (score, coverage) are never stored as evidence. `user` evidence outranks
extracted evidence for the same key.

Criteria determine where evidence comes from:

- `field` reads the structured field directly (`field: rent`).
- `text` extracts the criterion from the listing description into the criterion key
  (`source_ref: text:description`).
- `image` extracts the criterion from photos (`source_ref: sha256:…`).
- `derived` computes the criterion from fields or routes (`commute`, `price_per_bedroom`,
  `price_per_bathroom`) and stores it under the criterion key.

Every extracted fact keeps its confidence and provenance, so a score can always be traced
back to the description, photo, or route it came from.

## 9. Scoring

Hard filters drop a listing outright: domain limits (price, bedrooms, excluded areas,
required attributes, a hard commute), plus any criterion with a `hard` predicate. An unknown
required value is a failure, not a pass.

Each soft criterion in the brief is normalized with its own normalizer and weighted:

```
score    = Σ(s_c · w_c for known c) / Σ(w_c for known c)
coverage = Σ(w_c for known c) / Σ(w_c for all c)
```

- Criteria are read from the brief, never looked up in a preset. A brief's criteria are
  pinned, so re-scoring is reproducible later.
- `coverage` is reported alongside `score`. A high score on thin evidence is not a strong
  recommendation, and the export must say so.
- Unknown handling follows the criterion override or `unknown_policy`: `flag` (default)
  leaves it out of the numerator and reports the gap; `penalize` treats it as 0;
  `investigate` adds it to the gap queue. Suggested criteria always flag.
- A criterion's `origin` (`explicit` or `suggested`) and `source` are included in the
  breakdown, so the UI can explain where a score came from.
- Scores within 0.03 are a **tie band**, not a ranking. False precision is worse than a tie.
- Every score carries its breakdown, so the export can show
  `carpark +0.9 · commute +0.6 · sunlight unknown`.

## 10. Feedback protocol

Every incoming message is classified into exactly one action (ADR 0007):

| Action | Trigger | Work |
| --- | --- | --- |
| `re-score` | weight, preference, or soft threshold changed | re-filter + re-score from the database |
| `re-extract` | a new criterion or feature to look for | add/remove criteria, re-run text/vision over existing listings |
| `re-search` | coverage complaint or new area/source | discover and collect the delta, merge, re-score |

The runner reports the interpretation and the effect:

```
Understood: commute hard -> <=20 min, sunlight weight -> 0.
Re-filtered + re-scored 84 listings. 61 -> 23 pass. No new search.
```

If the interpretation is wrong, the next message corrects it. No silent autonomous replanning.

## 11. Sources and recipes

Discovery: a schema-constrained planner turns the brief into 1-8 short queries plus optional
bare-host site hints (ADR 0019). If the planner is unavailable or returns nothing, source
templates render from brief values as a fallback. Results are deduped by URL
canonicalization. The brief's source scope decides which sources participate; open web is the
default. Each query's hit count is logged.

Extraction: per-site recipes executed inside the page via chrome-devtools `evaluate_script`.

```ts
interface Recipe {
  id: string;                 // "trademe.co.nz"
  matches: RegExp;            // URL pattern
  version: number;
  search(): ListingRef[];     // runs in page
  listing(): RawListing;      // runs in page
}
```

- Recipes are deterministic and cheap per listing.
- Required fields are validated. A missing required field is a **recipe failure**, surfaced as
  an error and a board task — never a partial row.
- Page kind is decided at runtime (ADR 0018): a page whose extracted items point elsewhere is
  an index and is expanded into detail visits; the index URL is never stored as a listing.
- Site recipes win by priority. A generic **JSON-LD fallback** handles any other HTTP page
  that publishes `schema.org` structured data: it flattens `@graph` and `ItemList`, prefers
  listing entities (`Product`, `Vehicle`, `RealEstateListing`, …), and maps name, description,
  price, brand, model, year, mileage, condition, address, geo, and images.
- Pages without usable JSON-LD get a **generic HTML text fallback**: title, meta description
  or main text, canonical URL, obvious price, and og:image. Results are marked
  `sourceRef: generic:html` with confidence 0.5, are discarded under
  `sources.web: structured-only`, and are capped by `budgets.html_max`. Pages with no usable
  content still fail loudly (ADR 0016).
- Unknown sites without JSON-LD fall back to a single schema-constrained "propose a recipe"
  model call; the result is reviewed and stored as a recipe. There is no freeform browsing
  agent in the runtime (ADR 0010).
- Each source integration owns its discovery templates
  (`{ template, domains, requires, site }`). Discovery only asks registered sources and skips
  templates whose required values are empty (ADR 0013).
- Rate limits and session handling live in the runner, not in recipes.

## 12. Image and text evidence

Image evidence:

- Runs on **shortlisted survivors only**, capped by `vision_max` using the pre-vision score.
- Features come from the **brief's criteria** whose `source.type` is `image`.
- Transport: OpenCode Go `gpt-5.6-luna` through the router's `/v1/responses` endpoint, with
  base64 `input_image` and a JSON-schema output format (ADR 0009). Chat completions is not
  supported by that model.
- Images are downloaded and cached in `media/` keyed by content hash, because listings and
  their photos disappear (ADR 0004).
- Each image yields typed features with confidence and a provenance reference to the image
  hash — never a bare boolean.
- Claims are labeled as inferred. "Large north-facing window, direct sun in frame" is
  defensible; "sunny 9am–3pm" is not, and the export must not imply it.

Text evidence:

- Criteria with `source.type: text` run against the listing description. Descriptions are
  archived during detail visits.
- One schema-constrained model call per listing extracts all text criteria together, capped
  by `vision_max` and ordered by the pre-text score.
- The description is treated as untrusted data and delimited in the prompt; the model returns
  null when the description does not state a fact.
- Facts are stored under the criterion key with `source_ref: text:description`, so a
  re-extraction can be tied to the criteria version.

Derived evidence:

- `commute`, `price_per_bedroom`, and `price_per_bathroom` are computed from routes and
  structured fields after collection. The evaluator list is validated at compile time.

## 13. Geo and commute

- Geocode anchors and listing addresses with a provider; cache by normalized address.
- Ambiguous or failed matches go to an `unmatched` bucket and are not silently placed.
- Drive-time routing from day one behind a `RoutingProvider` interface (OpenRouteService v1).
  There is no straight-line fallback in the scoring path.
- Route results cache per `(origin, dest)` with `observed_at`; traffic-dependent times are not
  timeless. `drive_min` is stored on the listing.
- User locations stay local; nothing is sent to a provider beyond the coordinates required.

## 14. Data model

One SQLite database per campaign. Indicative schema:

```sql
brief_version(id, created_at, yaml, prompt)
listing(id, source, external_id, url, first_seen, last_seen, status, raw_json)
evidence(id, listing_id, key, value, source_type, source_ref, confidence, observed_at)
score(id, listing_id, brief_version_id, score, coverage, hard_pass, breakdown_json, computed_at)
feedback(id, at, text, action, delta_json, applied_at)
run(id, started_at, ended_at, cursor, stop_reason, spend_usd)
media(hash, listing_id, path, fetched_at)
recipe(id, version, code, last_ok_at)
```

- `listing` is unique on `(source, external_id)`; dedupe across sources is a fuzzy cluster on
  address + price + bedrooms (see §15).
- `score` is versioned by `brief_version_id`, so every ranking is reproducible from its brief.
- `run.cursor` is the checkpoint that makes pause and crash recovery free.

## 15. Budgets, stopping, and failure modes

Stopping is explicit, never "looks good enough":

- `max_listings`, `max_usd`, `max_minutes`, `vision_max`, `html_max`, and diminishing returns (a full
  discovery pass with no new passing listings).
- Every stop records a `stop_reason`.

| Failure | Response |
| --- | --- |
| Bot block / CAPTCHA | back off, slow the rate, surface as blocked; never hammer |
| DOM drift | recipe validation fails loudly; task created to repair |
| Broken/missing images | keep the listing, mark features unknown |
| Ambiguous geocode | `unmatched` bucket, reported |
| Invalid model JSON | one retry with the schema, then skip the batch and report |
| Cost ceiling | hard stop, export what exists |
| Search returns nothing | `search-unavailable`; warn in the summary, do not claim "no matches" |
| Results but no accepted seeds | `no-listing-pages`; warn in the summary |
| Context growth | batch sessions exit; state is external by design |

## 16. Open questions

- Criteria suggestion quality: how many suggestions are useful, and how to evaluate them.
- Additional derived evaluators beyond commute and price per bedroom/bathroom.
- Per-image/per-listing extraction cost ceilings and caching policy.
- CSV only, or CSV + XLSX with formatting.
- Trade Me session/auth handling; what is visible without login.
- Dedupe thresholds and whether relists merge or supersede.
- Whether to add an optional live Google Sheet later (explicitly deferred).

## 17. Field vocabulary

The core is listing-agnostic. There are no domain presets: a brief is prompt + criteria +
source scope + budgets, and it works the same for rentals, cars, laptops, or anything else.

- `src/domain/fields.ts` holds one canonical vocabulary emitted by structured-data and
  generic page extraction (`title`, `description`, `price`, `brand`, `model`, `condition`,
  `location`, …). It is a naming convention, not a gate: a criterion may name any key, and an
  unresolved key becomes an evidence gap rather than a compile error.
- Suggested criteria come from the compiler, which writes its own text and image prompts.
  There are no per-domain suggestion lists, image-feature templates, or default criteria.
- Source recipes remain the place where a site's own structure is understood. They must
  expose generic fields; nothing in discovery, collection, or scoring may depend on a domain
  label.
- `soft` briefs from before brief-owned criteria migrate only for the core vocabulary
  (`price`, `condition`); anything else is dropped with a warning.

The brief owns `criteria`; adding a criterion never requires touching a preset, the runner,
the scorer, the store, or the feedback protocol.

## 18. Milestones

Tracked on the **Research Harness** board. The design above is the dependency for every
implementation task.
