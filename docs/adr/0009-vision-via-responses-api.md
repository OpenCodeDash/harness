# 0009 — Vision via OpenCode Go on the Responses API

Status: accepted

## Context

The harness needs image evidence on the shortlist. The user has an OpenCode Go
subscription behind the local LLM router (`opencode.ai/zen/go/v1`).

The router is a pass-through: it forwards the request body unchanged except for swapping
`model` (50 MB body limit), so image content is not stripped. But routing is protocol
specific:

- `opencode-go-gpt-5.6-luna` returns `400 ModelProtocolUnsupported` on
  `/v1/chat/completions`, including for text-only requests.
- The same model works on `/v1/responses`.

Verified against the live router: a three-band image returned
`{"colors":["red","green","blue"]}` with schema-constrained output, via
`input_image` as a base64 data URL and `text.format` as JSON schema.

## Decision

Call the router's **Responses API** directly for vision from the runner, not through an
opencode scout session (which assumes chat completions via the provider SDK).

- Model: `opencode-go-gpt-5.6-luna`, configurable.
- Input: `input_image` with a base64 data URL; no image hosting required.
- Output: JSON-schema-constrained evidence (`text.format`), parsed from
  `output[].content[].output_text`.
- Wrap in a `VisionProvider` with a startup probe (tiny generated image) that fails loudly
  if the model or protocol changes.
- Pin the vision route to vision-capable models only. The router falls back on
  401/403/404/408/429 and 5xx; a text-only fallback would silently break image calls.

## Consequences

- Vision extraction is a direct HTTP dependency, independent of opencode's model metadata.
  The router does not advertise modalities in `/v1/models`, so capability must be probed or
  configured, never inferred.
- The runner needs a Responses-API parser, separate from any chat-completions client.
- Listing photos (base64) leave the machine to OpenCode Go. This is acceptable for public
  listings; anything sensitive must use a local model instead.
- Image tokens count against the Go plan's limits; the shortlist cap and `vision_max` budget
  remain load-bearing.
- If OpenCode Go changes protocol or model names, the probe fails the run instead of
  producing empty evidence.
