---
title: "Feature Pack"
description: "CORS, W3C trace context, idempotency keys, outbound secret masking, and adaptive load shedding."
order: 14
section: "Guide"
track: "reference"
---


Five governance and safety policies that ship in the core gateway. All are
disabled by default — enable them by adding a block to `gateway.config.json`.

## CORS

Answers preflight (`OPTIONS`) requests and adds the `Access-Control-*` headers
to real responses.

```json
{
  "cors": {
    "enabled": true,
    "allowOrigins": ["https://app.example.com"],
    "allowMethods": ["GET", "POST"],
    "allowHeaders": ["content-type", "authorization"],
    "allowCredentials": false,
    "maxAgeSeconds": 600
  }
}
```

- `allowOrigins: ["*"]` reflects any origin (and echoes the request origin when
  `allowCredentials` is true, since `*` is illegal with credentials).
- A preflight from a disallowed origin is rejected with `403` problem+json.
- Preflights are answered **before** auth and rate limiting, so they never
  require a key.

## W3C trace context

Reads an incoming `traceparent` header (continuing the trace) or starts a new
one, and echoes it on the response so callers can correlate.

```json
{ "traceContext": { "enabled": true } }
```

The trace id and span id are also available to plugins as
`ctx.state.traceId`, `ctx.state.spanId`, and `ctx.state.parentSpanId`.

## Idempotency keys

Deduplicates unsafe requests. A client sends an `Idempotency-Key` header on a
`POST`/`PATCH`; the first request is executed and its response stored, and any
repeat with the same key replays that stored response (`idempotent-replay:
true`).

```json
{ "idempotency": { "enabled": true, "ttlMs": 86400000, "maxEntries": 10000 } }
```

- Same key, different body → `400` (the key was reused for a different request).
- Same key while the first is still in flight → `409 Conflict`.
- The store is per-process and bounded; it is not shared across replicas.

## Outbound secret masking

Redacts secrets from upstream responses before they reach the client. Detects
JWTs, PEM private keys, and JSON fields named `secret`/`token`/`password`/
`api_key`.

```json
{ "secretMask": { "enabled": true, "replacement": "[REDACTED]" } }
```

Masked responses carry `x-secret-masked: true` and `x-masked-request-id`. Only
text and JSON bodies are inspected; `content-length` is corrected and
`transfer-encoding` is dropped when the body changes.

## Adaptive load shedding

Sheds load when the process is saturated, protecting it from collapse. The
concurrency limit adapts to observed p95 latency: it shrinks under high latency
and grows when latency is low, within the configured bounds.

```json
{ "loadShedding": { "enabled": true, "min": 16, "max": 1024, "targetP95Ms": 250 } }
```

When the limit is reached, new requests get a `503` problem+json
(`Server at capacity, retry shortly`). The slot is released when the response
completes, including when a later policy short-circuits the request.

## Ordering

Policies run in a fixed order regardless of the config order: load shedding →
CORS → trace context → idempotency → (auth, API keys, cache, upstream
credentials). Secret masking runs on the outbound path.
