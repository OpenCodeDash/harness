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
discovery with a model query planner and template fallback, source integrations that own their
recipes, brief-scoped
open-web discovery, the Trade Me integration, JSON-LD extraction with a budget-gated HTML
text fallback, a single domain-agnostic field vocabulary with arbitrary attribute specs, and
the chrome-devtools browser
client. Work is tracked on the
**Research Harness** kanban board.

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

### Daemon

```sh
npm run daemon
```

A long-lived, multi-campaign server for dash/backdash. It keeps one active run at a time and
exposes:

```
GET  /health
GET  /campaigns
POST /campaigns                    {prompt | brief, name?}
POST /campaigns/:id/feedback       {text}  (model-interpreted delta)
GET  /campaigns/:id
GET  /campaigns/:id/results
GET  /campaigns/:id/export.csv
GET  /campaigns/:id/events         SSE
POST /campaigns/:id/feedback       {text}
POST /campaigns/:id/pause|resume|stop
```

Daemon env: `HARNESS_ROOT` (default `campaigns`), `HARNESS_PORT` (7332), `HARNESS_HOST`
(127.0.0.1), `HARNESS_TOKEN` (bearer auth; set it before exposing). With no token the API is
unauthenticated and warns on startup.

For a server deploy: Node 24, a Chromium binary (`CHROME_PATH`), and `npx` able to run
`chrome-devtools-mcp@latest` (pre-cache it on an offline host). The browser runs headless by
default; set `HARNESS_HEADLESS=0` for a visible browser while debugging. Keep
`HARNESS_ROOT` on persistent storage. Backdash reaches the daemon with
`HARNESS_URL` + `HARNESS_TOKEN`; build dash with `VITE_BACKDASH_URL` pointing at the
backdash origin.

The single-campaign control API is local-only:

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
- `HARNESS_HEADLESS` — set `0` to show the automation browser; headless otherwise.
- `ORS_API_KEY` — OpenRouteService key for drive-time scoring. Without it, commute is unknown.
- `ROUTER_API_KEY` — sent as a bearer token to the router if set.
