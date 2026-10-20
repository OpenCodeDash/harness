# 0010 — No opencode in the runtime; custom loop over MCP and the router

Status: accepted

Supersedes [0005](0005-runner-plus-short-scout-sessions.md).

## Context

The first draft put the browsing step inside short opencode scout sessions, because the
chrome-devtools and SearXNG MCP servers are already configured in opencode. That conflates the
tooling host with the runtime, and it breaks on the model we actually want:

- `opencode-go-gpt-5.6-luna` is Responses-API only; opencode's OpenAI-compatible provider
  speaks chat completions (ADR 0009).
- Site recipes make collection deterministic. Browsing does not need a multi-turn agent, so
  there is no agent loop to justify a session at all.
- A custom harness should not depend on opencode's session, permission, or model-metadata
  semantics to do its job.

## Decision

The runtime is a standalone TypeScript process with no opencode dependency.

- **Browser:** connect to the chrome-devtools MCP server as an MCP client, using the same
  server command opencode uses. Navigate, then run a site recipe via `evaluate_script`.
- **Search:** SearXNG over HTTP.
- **Models:** one-shot, schema-constrained `/v1/responses` calls for description extraction,
  vision, query planning, and recipe authoring/repair. No multi-turn browsing loop.
- **Chat:** opencode is an optional front-end. It exposes runner operations as tools
  (`status`, `brief`, `feedback`, `pause`, `resume`, `export`). A CLI can replace it later.

Collection is deterministic: a recipe either returns valid structured data or fails loudly.
The model is never on the path between a listing page and the database unless a site has no
recipe, in which case it makes a single "propose a recipe" call whose output is reviewed and
stored.

## Consequences

- The harness runs without opencode installed and is testable as plain code.
- No session lifecycle, no context compaction, no permission model to reason about.
- We own a small MCP client and a small retry/validation layer, but not an agent loop.
- Recipe authoring still benefits from a model, ideally at development time against saved
  fixtures rather than live at runtime.
- The chat surface is decoupled and replaceable; losing it does not affect a running campaign.
- Browsing and extraction can be unit-tested against HTML fixtures without a model.
