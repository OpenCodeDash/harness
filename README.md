# harness

Personal research harness. Give it a brief — "2–3 bed rental under $650 near work" — and it
discovers listings, records evidence, rates them against your weighted requirements, and
exports a spreadsheet. It stays steerable: pause it, tell it what it got wrong, and it
re-scores or re-searches without starting over.

Local, single-user, TypeScript. No containers, no service, no multi-tenancy.

## Design

- [`docs/design.md`](docs/design.md) — how it works
- [`docs/adr/`](docs/adr/README.md) — decisions and their consequences

## Status

Core is implemented and tested: store, briefs, scoring, feedback, export, SearXNG
discovery, recipes, the Trade Me recipe, and the chrome-devtools browser client. Work is
tracked on the **Research Harness** kanban board.

## Commands

```sh
npm install
npm run check      # typecheck + tests
npm test
npm run typecheck
```

## Environment

- `CHROME_PATH` — Chromium executable for the chrome-devtools MCP server. Auto-detects
  common paths; set it if auto-detection fails.
- `SEARXNG_MCP_URL` — SearXNG MCP endpoint (e.g. `http://host:8049/mcp`).
- `ORS_API_KEY` — OpenRouteService key for drive-time scoring.
- `OPENCODE_GO_API_KEY` — used by the router, not by the harness directly.
