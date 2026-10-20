# 0005 — Runner plus short scout sessions

Status: superseded by [0010](0010-no-opencode-in-runtime.md)

## Context

A single long agent session is the simplest thing to build, but it accumulates context until
compaction discards exactly the details that matter, its cost grows with run length, and a
crash loses everything not externalized. The user needs pause, resume, and mid-run feedback.

## Decision

A local **runner** process owns the state machine, budgets, checkpoints, and all writes. It
spawns **short scout sessions** — at most one results page or five listings — which return
structured JSON and exit. A separate **chat agent** steers the runner through tools.

## Consequences

- Context per session stays small and predictable; cost scales with listings, not run length.
- Resume is free: the runner reads `run.cursor`, no session history is needed.
- Pause is a flag checked at batch boundaries; an in-flight batch completes.
- The runner must own dedupe, validation, and retries, because scout sessions are stateless.
- Scout sessions cannot make progress decisions; stopping is always the runner's call.
- One extra process and a small local API to maintain.
