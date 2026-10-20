# 0001 — Personal, local tool: no containers or isolation

Status: accepted

## Context

`fleet` exists to run many ephemeral, untrusted coding tasks concurrently. Its value is the
security substrate: per-task containers, an egress allowlist, scoped credentials, and a
control plane.

This harness has a different shape: one person, one machine, one active campaign at a time,
browsing public listings. The interesting risk is not multi-tenancy; it is prompt injection
from listing pages and cost. There is no untrusted co-tenant to isolate from.

## Decision

Run as a single local process with local files. No containers, no egress proxy, no credential
broker, no board-driven orchestration. Reuse `fleet`'s in-process ideas only:
`agents/runner.ts` (driving opencode sessions), `limits/` (rate limits), and
`observability/redact.ts` (log hygiene).

## Consequences

- Far less to build and operate; the whole thing can run on a laptop.
- Prompt injection is handled by capability scoping inside the opencode session (read-only
  browser tools, no shell, no credentials) rather than by network isolation.
- If this ever becomes multi-user, the isolation work is a real project, not a config change.
  Keep the scout boundary narrow now so the session can later run elsewhere.
- Local session cookies and addresses must never be committed.
