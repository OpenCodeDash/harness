# 0008 — Spreadsheet is an export-only view

Status: accepted

## Context

The user wants results in a spreadsheet. Two-way sync (Google Sheets, or importing edited
files) is convenient but creates a second source of truth, conflict resolution, and a second
place for scores to drift from evidence. The user asked for in-chat feedback as the primary
steering mechanism.

## Decision

Spreadsheets are generated from the campaign database: CSV in v1, XLSX formatting later.
Never read back. Feedback stays in chat (ADR 0007). A live Google Sheet is explicitly deferred
and would be a separate ADR if adopted.

## Consequences

- One source of truth; exports can always be regenerated and are never stale relative to the
  database.
- Edits made in the spreadsheet are lost on the next export. This must be stated in the
  export header or README.
- The export must carry evidence, confidence/coverage, unknown gaps, and links; otherwise the
  user will want to edit it.
- If annotations are later wanted, the right shape is a dedicated import step that produces
  `user` evidence, not a live two-way sheet.
