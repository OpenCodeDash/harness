# ADRs

One decision per file. Status is `proposed`, `accepted`, or `superseded`.

| # | Decision | Status |
| - | -------- | ------ |
| [0001](0001-personal-local-no-containers.md) | Personal, local tool — no containers or isolation | accepted |
| [0002](0002-evidence-then-deterministic-scoring.md) | Models extract evidence; scoring is deterministic | accepted |
| [0003](0003-site-recipes-over-freeform-browsing.md) | Site recipes over freeform browsing | accepted |
| [0004](0004-sqlite-campaign-store.md) | SQLite campaign store + cached media | accepted |
| [0005](0005-runner-plus-short-scout-sessions.md) | Runner plus short scout sessions | superseded by 0010 |
| [0006](0006-drive-time-routing-v1.md) | Drive-time routing from v1 | accepted |
| [0007](0007-feedback-as-three-action-delta.md) | Feedback is a delta with three actions | accepted |
| [0008](0008-export-only-spreadsheet.md) | Spreadsheet is an export-only view | accepted |
| [0009](0009-vision-via-responses-api.md) | Vision via OpenCode Go on the Responses API | accepted |
| [0010](0010-no-opencode-in-runtime.md) | No opencode in the runtime; custom loop over MCP and router | accepted |
| [0011](0011-dynamic-criteria.md) | Criteria are brief-owned, compiled from the prompt | accepted |
| [0012](0012-generic-jsonld-recipe.md) | Generic JSON-LD recipe as the extraction fallback | accepted |
| [0013](0013-sources-own-discovery.md) | Source integrations own discovery query templates | accepted |
| [0014](0014-brief-source-scope.md) | Open web by default, brief-scoped sources | accepted |
| [0015](0015-optional-domain-packs.md) | Domain packs are optional presets with a generic fallback | superseded by 0017 |
| [0016](0016-generic-html-fallback.md) | Generic HTML text fallback for non-JSON-LD pages | accepted |
| [0017](0017-remove-domain-packs.md) | Remove domain packs; one canonical field vocabulary | accepted |
| [0018](0018-runtime-page-classification.md) | Classify pages at runtime and expand index pages | accepted |
| [0019](0019-model-planned-discovery.md) | Plan discovery queries with the model | accepted |
| [0020](0020-seeds-and-model-feedback.md) | Brief seeds and model-interpreted feedback | accepted |

Add a new ADR rather than editing an accepted one; supersede it instead.
