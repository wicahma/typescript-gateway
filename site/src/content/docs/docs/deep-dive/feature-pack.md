---
title: "Feature Pack"
description: "CORS, W3C trace context, idempotency keys, outbound secret masking, adaptive load shedding, request record/replay, and audit event stream."
---

Governance, traffic, and safety policies that ship in the core gateway. All policies are disabled by default.

## What It Does

The feature pack adds extended operational governance and safety policies without external dependencies:

### Traffic Governance & Resilience
- **CORS**: Handles preflight (`OPTIONS`) requests and adds standard `Access-Control-*` headers. Preflights execute before authentication and rate limiting.
- **W3C Trace Context**: Parses inbound `traceparent` headers to propagate distributed traces or seeds new trace and span IDs, exposing them to plugins via `ctx.state`.
- **Idempotency Keys**: Deduplicates unsafe HTTP methods (`POST`, `PATCH`, `PUT`) by caching responses keyed by `Idempotency-Key` headers. Replaying requests returns `idempotent-replay: true`.
- **Adaptive Load Shedding**: Dynamically sizes the concurrent request ceiling based on observed P95 latency. Saturated conditions immediately return HTTP 503 Problem Details.
- **Traffic Shadowing**: Asynchronously mirrors a sampled fraction of production traffic to a test upstream (`x-shadow: true`) with zero impact on caller response latency.
- **Sticky Sessions**: Affinitizes callers to specific upstream instances via cookie or header hashing.

### Identity & Security Governance
- **Outbound Secret Masking**: Inspects upstream response bodies for JWTs, PEM private keys, and common sensitive keys (`password`, `token`, `secret`), replacing them with redacted placeholders.
- **Inbound HMAC Verification**: Validates raw request body signatures against shared secrets before request routing.
- **Daily Quotas**: Implements 24-hour request ceilings per authenticated consumer identity alongside short-term rate limits.
- **SSRF Guard**: Restricts outbound proxying to private, loopback, or cloud metadata IP ranges unless explicitly allowlisted.
- **Security Headers**: Injects baseline hardening headers (HSTS, CSP, X-Frame-Options) and strips internal server identifying headers.

### Operations & Diagnostics
- **Admin Control Plane**: Provides secured introspection endpoints (`/__admin/state`) and cache purge mechanisms (`POST /__admin/cache/purge`).
- **OpenAPI Route Generation**: Imports route manifests directly from OpenAPI 3.1 specification documents, supporting both `{param}` and `:param` path syntax.
- **Request Record & Replay**: Stores incoming requests and responses in memory to allow offline reproduction and test case generation (`x-replay-id`).
- **Audit Event Stream**: Emits NDJSON structured audit records to stdout with automatic redaction of credential fields.

## Configuration

Feature pack policies are enabled in `gateway.config.json`:

| Policy | Configuration Block | Default | Key Controls |
|---|---|---|---|
| CORS | `cors` | Disabled | `allowOrigins`, `allowMethods`, `allowHeaders`, `allowCredentials`, `maxAgeSeconds`. |
| Trace Context | `traceContext` | Disabled | `enabled: true`. |
| Idempotency | `idempotency` | Disabled | `ttlMs: 86400000`, `maxEntries: 10000`. |
| Secret Masking | `secretMask` | Disabled | `replacement: "[REDACTED]"`. |
| Load Shedding | `loadShedding` | Disabled | `min: 16`, `max: 1024`, `targetP95Ms: 250`. |
| Shadowing | `shadow` | Disabled | `target: "http://127.0.0.1:9999"`, `sampleRate: 0.1`. |
| Inbound HMAC | `verifyInboundHmac` | Disabled | `secret: "${WEBHOOK_SECRET}"`. |
| SSRF Guard | `ssrfGuard` | Disabled | `allowlist: ["internal.example.com"]`. |
| Security Headers | `securityHeaders` | Disabled | `hsts: "max-age=31536000"`, `stripServer: true`. |
| Sticky Sessions | `stickySession` | Disabled | `upstreams: ["a", "b"]`. |
| Admin API | `admin` | Disabled | `basePath: "/__admin"`, `requireAuth: true`. |
| Record & Replay | `record`, `replay` | Disabled | `maxEntries: 1000`, `maxAgeMs: 3600000`. |
| Audit Stream | `audit` | Disabled | `sampleRate: 1`, `includeHeaders: false`. |

```json
{
  "cors": {
    "enabled": true,
    "allowOrigins": ["https://app.example.com"],
    "allowMethods": ["GET", "POST"],
    "allowHeaders": ["content-type", "authorization"],
    "allowCredentials": false,
    "maxAgeSeconds": 600
  },
  "traceContext": { "enabled": true },
  "idempotency": { "enabled": true, "ttlMs": 86400000, "maxEntries": 10000 },
  "secretMask": { "enabled": true, "replacement": "[REDACTED]" },
  "loadShedding": { "enabled": true, "min": 16, "max": 1024, "targetP95Ms": 250 }
}
```

## Interactions

Feature pack policies execute in a deterministic pipeline sequence regardless of their declaration order in the configuration file:

1. **Load Shedding**: Verifies concurrency headroom; drops incoming connections with 503 if overloaded.
2. **CORS Preflight**: Responds to HTTP `OPTIONS` requests immediately without incurring auth overhead.
3. **Trace Context**: Parses incoming `traceparent` or generates trace identifiers on `ctx.state`.
4. **Idempotency**: Checks whether an `Idempotency-Key` exists and has an existing cached result.
5. **SSRF Guard**: Validates destination IP targets before network requests are dispatched.
6. **Inbound HMAC**: Validates cryptographic payload signatures.
7. **Sticky Sessions & Shadowing**: Selects session affinity instances and registers asynchronous shadow tasks.
8. **Security Headers & Auth**: Enforces TLS policies and executes authentication and quota policies.
9. **Audit, Record & Replay**: Emits audit records and stores or replayed responses.
10. **Outbound Secret Masking**: Intercepts upstream payload bodies, redacting secrets before transmitting bytes to clients.

## Tradeoffs and Failure Modes

- **In-Memory Store Isolation**: The idempotency cache, request recording engine, and sticky session affinity table are maintained in process memory. In a distributed multi-instance deployment, requests must share a routing layer or stick to a single gateway node to share state.
- **Adaptive Load Shedding Oscillation**: Setting `targetP95Ms` too close to normal upstream response latency can cause rapid cycling between shedding and normal operation; configure sufficient headroom between target P95 and normal latency.
- **Secret Masking Performance**: Scanning response bodies for JWTs and JSON keys requires parsing JSON or buffering text chunks. Masking is intentionally bypassed for binary streams (`application/octet-stream`, images) to prevent memory bloating.
- **Shadowing Upstream Pressure**: Shadowed traffic creates additional request volume against upstream test environments; rate sampling (`sampleRate`) and max inflight boundaries prevent cascading test server degradation.
