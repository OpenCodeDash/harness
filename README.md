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

## Running

```sh
# Compile a brief from a prompt, then research
npm run dev -- --prompt "2-3 bed rental in Wellington under $650 near work" --now

# Or start from a YAML brief
npm run dev -- --brief brief.yaml --now

# Serve the control API too (status, feedback, pause, resume, export)
npm run dev -- --prompt "..." --serve
```

The control API is local-only:

- `GET /status`
- `GET /brief`
- `GET /export.csv`
- `POST /feedback {"text":"..."}`
- `POST /pause`
- `POST /resume`
- `POST /run`

## Environment

- `CHROME_PATH` — Chromium executable for the chrome-devtools MCP server. Auto-detects
  common paths; set it if auto-detection fails.
- `SEARXNG_MCP_URL` — SearXNG MCP endpoint (e.g. `http://host:8049/mcp`).
- `ROUTER_BASE_URL` — LLM router base URL (default `http://192.168.68.51:3005/v1`).
- `HARNESS_MODEL` — Responses-API model (default `opencode-go-gpt-5.6-luna`).
- `ORS_API_KEY` — OpenRouteService key for drive-time scoring. Without it, commute is unknown.
- `ROUTER_API_KEY` — sent as a bearer token to the router if set.
