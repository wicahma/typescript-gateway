---
title: "Usage Guide"
description: "Practical recipes: proxying, auth, rate limiting, caching, load balancing, and custom plugins."
order: 12
section: "Guide"
---

# Usage Guide

End-to-end recipes for the most common gateway setups. All examples use the real config schema from `src/types/config.ts` and `src/types/identity.ts` — nothing here is aspirational.

## Basic Reverse Proxy

Route traffic to a single backend. Routes not in the reserved set (`/`, `/health`, `/metrics`) are proxied to the first configured upstream.

```json
{
  "server": { "port": 3000, "host": "0.0.0.0" },
  "routes": [
    { "method": "GET", "path": "/api/:id", "priority": 0 },
    { "method": "POST", "path": "/api/orders", "priority": 0 },
    { "method": "GET", "path": "/static/*", "priority": 0 }
  ],
  "upstreams": [
    {
      "id": "backend",
      "protocol": "http",
      "host": "127.0.0.1",
      "port": 8080,
      "basePath": "",
      "poolSize": 10,
      "timeout": 30000,
      "healthCheck": {
        "enabled": true,
        "path": "/health",
        "interval": 30000,
        "timeout": 5000,
        "expectedStatus": 200
      }
    }
  ],
  "plugins": [],
  "performance": { "workerCount": 0, "contextPoolSize": 1000, "bufferPoolSize": 1000, "responsePoolSize": 1000, "enablePooling": true }
}
```

Path patterns: `:param` captures one segment, `*` is a terminal wildcard. A trailing slash is equivalent to no trailing slash. Reserved paths (`/`, `/health`, `/metrics`) are always handled by the gateway itself.

Run and verify:

```bash
PORT=8088 npm start
curl http://localhost:8088/api/42          # -> proxied to backend /api/42
curl http://localhost:8088/health          # -> gateway health report
```

## JWT Authentication

Enabled when an `auth` block is present and `enabled !== false`. JWTs are verified against a JWKS (`node:crypto` only — no external JWT library). Invalid tokens get a 401 `application/problem+json` response; valid identity lands in `ctx.state.user`.

```json
{
  "auth": {
    "enabled": true,
    "issuer": "https://id.example.com",
    "audience": "my-api",
    "leewaySeconds": 30,
    "publicRoutes": ["/health", "/metrics", "/auth/login"],
    "jwks": { "keys": [ { "kty": "RSA", "n": "...", "e": "AQAB", "kid": "2026-01" } ] }
  }
}
```

## API Keys + Per-Consumer Rate Limits

Enabled when `apiKeys.enabled` and `apiKeys.consumers` are set. Two policies are registered automatically: `ApiKeyPolicy` (validates `x-api-key` against issued keys) and `ConsumerRateLimitPolicy` (per-consumer quota).

```json
{
  "apiKeys": {
    "enabled": true,
    "headerName": "x-api-key",
    "cacheTtlSeconds": 60,
    "cacheMaxEntries": 1000,
    "publicRoutes": ["/health"],
    "consumers": [
      {
        "consumerId": "mobile-app",
        "plan": "free",
        "rateLimit": 100,
        "keys": [ { "key": "ak_live_...", "expiresAt": 1798761600000 } ]
      },
      {
        "consumerId": "partner-internal",
        "plan": "unlimited",
        "rateLimit": 0,
        "keys": [ { "key": "ak_live_..." } ]
      }
    ]
  }
}
```

`rateLimit` is requests per minute per consumer; `0` means unlimited. Keys are resolved through an in-memory `ConsumerStore` with a TTL cache in front — after the first hit, validation is a cache lookup.

## Response Caching

Enabled when `responseCache.enabled` is set. `ResponseCachePolicy` short-circuits cache hits before the upstream is touched and adds an `x-cache: HIT|MISS` header.

```json
{
  "responseCache": { "enabled": true }
}
```

## Upstream Credential Injection + HMAC Signing

For upstreams that require static headers or HMAC request signing (e.g. internal services behind a signature check). Credentials live in the gateway config; headers are injected (or signatures computed) right before forwarding.

```json
{
  "upstreamCredentials": {
    "enabled": true,
    "credentials": [
      {
        "name": "billing-service",
        "headers": { "x-internal-token": "..." },
        "hmac": { "secret": "${BILLING_HMAC_SECRET}", "keyId": "gw-1", "headerNamespace": "x-hmac" }
      }
    ],
    "injection": { "credentialName": "billing-service", "publicRoutes": ["/health"] },
    "signing": { "credentialName": "billing-service", "publicRoutes": ["/health"] }
  }
}
```

Secrets support env interpolation (`${VAR}` / `${VAR:-default}`) — never commit raw secrets.

## Custom Plugin (Code-Level)

The declarative `plugins` array exists in the schema, but the pipeline policies are wired programmatically in `src/index.ts`. To add your own inbound/outbound logic, implement the `GatewayPolicy` interface (`src/pipeline/policy.ts`) and register it:

```ts
import { GatewayPolicy, RequestContext, OutboundResponse } from './pipeline/policy.js';

class TenantHeaderPolicy implements GatewayPolicy {
  name = 'tenant-header';

  // inbound: may return a Response to short-circuit, or void to continue
  async executeInbound(ctx: RequestContext): Promise<Response | void> {
    const tenant = ctx.headers['x-tenant'];
    if (!tenant) {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Missing tenant', status: 400 }), {
        status: 400,
        headers: { 'content-type': 'application/problem+json' },
      });
    }
    ctx.state.tenant = tenant;
  }

  // outbound: receives and may replace the OutboundResponse
  async executeOutbound(ctx: RequestContext, response: OutboundResponse): Promise<OutboundResponse> {
    response.headers['x-tenant'] = String(ctx.state.tenant ?? '');
    return response;
  }
}

// in src/index.ts, after config load:
pipeline.register(new TenantHeaderPolicy());
```

Execution order = registration order. The first inbound policy returning a `Response` short-circuits the chain (upstream never sees the request). Outbound policies compose left-to-right over the `OutboundResponse`.

## Programmatic Rate Limiting (Plugin Hook API)

For limiter strategies beyond the consumer quota above, the `Plugin` hook API (`src/types/plugin.ts`) + `RateLimitPlugin` (`src/plugins/builtin/rate-limit-plugin.ts`) supports token-bucket and sliding-window strategies keyed by IP, header, upstream, or consumer:

```ts
import { createRateLimitPlugin } from './plugins/builtin/rate-limit-plugin.js';

const limiter = createRateLimitPlugin({
  enabled: true,
  strategies: [
    { name: 'api-burst', type: 'token-bucket', capacity: 50, refillRate: 10, keyExtractor: 'ip', includeHeaders: true },
    { name: 'api-quota', type: 'sliding-window', windowMs: 60000, maxRequests: 300, keyExtractor: 'header', headerName: 'x-api-key' },
  ],
});
// register on a PluginExecutionChain or run preRoute manually
```

Token bucket absorbs short bursts at a sustained average; sliding window enforces hard "N per minute" quotas. Both are in-memory and zero-dependency.

## Load Balancing Across Upstreams

Multiple upstreams with the same role are selected per request by the `LoadBalancer` (round-robin / ip-hash / weighted; health-aware). Mark a `weight` per upstream to skew traffic:

```json
{
  "upstreams": [
    { "id": "api-a", "host": "10.0.0.1", "port": 8080, "weight": 3, "healthCheck": { "enabled": true, "path": "/health" } },
    { "id": "api-b", "host": "10.0.0.2", "port": 8080, "weight": 1, "healthCheck": { "enabled": true, "path": "/health" } }
  ]
}
```

Unhealthy upstreams (per active + passive checks) stop receiving traffic immediately; circuit breakers per upstream prevent retry storms during partial outages.

## Verifying Your Setup

```bash
# health + upstream report
curl -s http://localhost:8088/health | jq

# metrics snapshot (latency histogram, pool hit rates, per-upstream stats)
curl -s http://localhost:8088/metrics | jq

# auth rejection path (expect 401 problem+json)
curl -i http://localhost:8088/api/private

# rate limit path (expect 429 after quota, with rate limit headers if enabled)
for i in $(seq 1 120); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8088/api/ping; done | sort | uniq -c
```
