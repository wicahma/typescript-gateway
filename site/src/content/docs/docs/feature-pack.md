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


## Milestone B additions

### Traffic shadowing

Mirror a sampled fraction of live traffic to a shadow upstream for safe
validation. Fire-and-forget: a slow or failing shadow never affects the client.

```json
{ "shadow": { "enabled": true, "target": "http://127.0.0.1:9999", "sampleRate": 0.1 } }
```

Mirrored requests carry `x-shadow: true`; in-flight mirrors are bounded by
`maxInflight`.

### Inbound HMAC verification

Verify a webhook signature over the raw request body before accepting it.

```json
{ "verifyInboundHmac": { "enabled": true, "secret": "${WEBHOOK_SECRET}" } }
```

Rejects with `401` problem+json on a missing, wrong, or expired signature.

### Daily quota per consumer

Adds a rolling daily request budget on top of the per-minute rate limit; the
`429` carries the daily counters.

```json
{ "apiKeys": { "enabled": true, "consumers": [
  { "consumerId": "c1", "plan": "pro", "rateLimit": 600, "dailyLimit": 100000, "keys": [{ "key": "..." }] }
] } }
```

### SSRF guard

Rejects requests whose target host resolves to a private/loopback/link-local
address (or `localhost`/`.internal`), unless allowlisted.

```json
{ "ssrfGuard": { "enabled": true, "allowlist": ["internal.example.com"] } }
```

### Security headers

Adds hardening headers and strips server banners from responses.

```json
{ "securityHeaders": { "enabled": true, "hsts": "max-age=31536000", "stripServer": true } }
```

### Sticky sessions

Pins a caller (by header or cookie) to one upstream for cache locality.

```json
{ "stickySession": { "enabled": true, "upstreams": ["a", "b", "c"] } }
```

### Admin control plane

Read-only operational state and cache purge, gated by the same identity as the
rest of the gateway (`requireAuth`).

```json
{ "admin": { "enabled": true, "basePath": "/__admin", "requireAuth": true } }
```

- `GET /__admin/state` — uptime, breaker states, cache stats, load-shed info,
  active policy names.
- `POST /__admin/cache/purge` — body `{ "pattern": "<regex>" }`; returns the
  purged entry count.

### OpenAPI `{param}` route syntax

Routes accept `{id}` (OpenAPI style) as well as `:id`, plus regex groups
(`/orders/:orderId(\d+)`).

```json
{ "routes": [{ "method": "GET", "path": "/users/{id}" }] }
```

### OpenAPI document as routing source

Declare every route from an OpenAPI 3.1 document instead of hand-listing them.

```json
{ "openapi": { "enabled": true, "basePath": "/api", "spec": { "openapi": "3.1.0", "paths": { "/users/{id}": { "get": {} } } } } }
```
