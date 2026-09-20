---
title: "Traffic Control (F3)"
description: "Rate limiting, response caching, and load balancing across upstreams."
order: 6
section: "Features"
---

All 3 features in this group are **implemented and verified** — each has a full FSD + ERD spec pair and unit/integration coverage in the repo test suite.

## Load Balancer

The Load Balancer picks one healthy upstream for every request that passes routing
and rate limiting. Five algorithms are selectable via configuration, and upstreams
flagged unhealthy are automatically pulled from rotation.

Implementation: `src/core/load-balancer.ts`, the `LoadBalancer` class (313 lines), used by
`ProxyHandler` (`src/core/proxy-handler.ts` lines 82, 97, 182). Pure stdlib
(`crypto` for IP hashing, `process.hrtime.bigint` for durations) — zero-dep.

### How it works

Each `select(context)`:

1. **Health filter** — `healthAware` (default true) drops upstreams with
   `healthy === false`. If nothing remains: log `warn` + return `null`
   (→ the proxy handler throws `No healthy upstream available`).
2. **Pick algorithm** per `strategy`:
   - **`round-robin`** (default) — cyclic `index % n`, one moving pointer.
   - **`least-connections`** — pick the smallest `activeConnections` (tie → first).
   - **`weighted-round-robin`** — build a virtual list per weight (`weight || 1`),
     then round-robin over it; weight 3 = 3× more slots.
   - **`ip-hash`** — `md5(clientIp)` → first 8 hex chars → modulo; the same client
     always lands on the same upstream (sticky). Without clientIp → fallback
     round-robin + log `warn`.
   - **`random`** — `Math.random()` picks uniformly.
3. **Update metrics** — `totalRequests++` and `requestsPerUpstream[id]++`.
4. **Debug log** — selection duration (`process.hrtime.bigint()`).

Supporting metrics: `recordError`, `recordLatency` (moving average per upstream),
`updateHealth` (flips the upstream `healthy` flag + `healthPerUpstream`),
`getDistribution()` (percent per upstream), `getMetrics()`, `resetMetrics()`.

### Configuration

| Option | Default | Location | Effect |
|---|---|---|---|
| `strategy` | `round-robin` | `LoadBalancer(strategy)` | enum: `round-robin` / `least-connections` / `weighted-round-robin` / `ip-hash` / `random` |
| `healthAware` | `true` | `LoadBalancer(strategy, healthAware)` | drop `healthy=false` upstreams from rotation |
| `weight` | `1` | `upstreams[].weight` in config | only applies to weighted-round-robin |
| `activeConnections` | `0` | runtime, mutated by the proxy handler | input to least-connections |
| `strategy` (config) | — | `performance{}` / upstream config | `LoadBalancerStrategy` field exists on `UpstreamConfig`; ProxyHandler currently instantiates the default and filters via routing |

`setStrategy(strategy)` allows changing algorithms without restart (resets
`currentIndex`); `setHealthAware(bool)` toggles the health filter at runtime.

### Edge cases

| Trigger | Behavior | User-visible result |
|---|---|---|
| All upstreams unhealthy | `select` returns `null` | Proxy error `No healthy upstream available` |
| One upstream left | `n=1`: modulo is always 0 | All requests go to that upstream |
| `ip-hash` without client IP | Falls back to round-robin + log `warn` | Distribution no longer sticky |
| `ip-hash` when the upstream count changes | Modulo changes → total remap | Sessions not sticky for remapped clients |
| `weight: 0` or missing | `weight || 1` → 1× slot | Safe, never 0 slots |
| Equal weights on weighted | Equivalent to pure round-robin | No bias |
| `activeConnections` not tracked (undefined) | `|| 0` → all tie | least-connections degenerates to the first upstream |
| `setUpstreams` replaced while running | `currentIndex` resets to 0 | Rotation restarts at the first upstream |
| `Math.random()` for random | ≈ uniform distribution | No deterministic guarantee (unsuitable for exact tests) |


## Rate Limiter

The Rate Limiter caps the number of requests the gateway accepts per unit of time,
keyed per client IP, per header (e.g. API key), or per upstream. Its goal is to protect
upstreams from traffic spikes and abuse without adding external dependencies.

Two algorithms, both in-memory and zero-dep:

1. **Token Bucket** (`src/core/rate-limiter.ts`, the `TokenBucketRateLimiter` class) —
   burst capacity of `capacity` tokens, refilled at `refillRate` tokens/second. A good fit for
   limiting short bursts while allowing a constant average.
2. **Sliding Window Counter** (the `SlidingWindowRateLimiter` class) — maximum
   `maxRequests` requests within a `windowMs` sliding window. A good fit for hard quotas of
   "N per minute" without bursts.

Both are wrapped by the `rate-limit` plugin (`src/plugins/builtin/rate-limit-plugin.ts`)
which runs on the `preRoute` hook and short-circuits requests with HTTP 429.

### Configuration

Configured via `plugins[]` in `config/gateway.config.json` (`PLUGIN_CONFIG` entity,
PERSISTED). Example:

```json
{
  "name": "rate-limit",
  "config": {
    "enabled": true,
    "includeHeaders": true,
    "strategies": [
      {
        "name": "per-ip",
        "type": "token-bucket",
        "capacity": 100,
        "refillRate": 10,
        "keyExtractor": "ip",
        "routes": ["/api/*"],
        "statusCode": 429,
        "message": "Too Many Requests"
      },
      {
        "name": "per-key",
        "type": "sliding-window",
        "windowMs": 60000,
        "maxRequests": 1000,
        "keyExtractor": "header",
        "headerName": "x-api-key"
      }
    ]
  }
}
```

| Option | Default | Notes |
|---|---|---|

*(trimmed — full detail lives in the project vault)*

### Edge cases

| Trigger | Behavior | User-visible result |
|---|---|---|
| New client (key not seen yet) | Bucket/window created full | Request forwarded normally |
| Burst exceeding `capacity` | Tokens exhausted, `allowed = false` | HTTP 429 + `Retry-After` + `X-RateLimit-*` |
| `keyExtractor: "header"` without `headerName` | `extractKey` returns `null` | Strategy skipped (fail-open), request forwarded |
| Key header absent from the request | Empty value → `null` | Strategy skipped |
| `remoteAddress` unavailable | Key `null` | Strategy skipped (no crash) |
| More unique IPs than `maxBuckets` | LRU eviction of the oldest bucket | Evicted keys start fresh (quota reset) — trade-off against memory exhaustion |
| Multiple strategies match, one rejects | Loop stops at the first rejection | 429 response from the first failing strategy |
| `routes` doesn't match the path | Strategy skipped | No token consumption |
| Gateway restart | All in-memory state lost | Quota fully reset (TRANSIENT, by design) |


## Response Cache

The Response Cache stores cacheable upstream HTTP responses in memory and
serves them back without touching the upstream. Its goal is to cut latency and upstream
load for repeated GETs, with correct HTTP caching semantics
(`Cache-Control`, ETag, conditional requests) — without a single external dependency.

Implementation: `src/core/response-cache.ts`, the `ResponseCache` class (514 lines).
Pure `Map` + `node:crypto` for key/ETag hashing. Zero-dep.

### How it works

1. **Cache key** (`generateKey`): `sha256(method | url | sorted varyHeaders)`.
   The `Vary` header is included in the key so different per-header representations
   are stored separately.
2. **Storing** (`set`): reject responses larger than `maxSize`
   (fail-safe, never evict to fit); evict LRU until it fits (bounded by `maxEntries` and
   `maxSize` bytes); old entries with the same key are overwritten (size debited first).
3. **Reading** (`get`): check age `(now - cachedAt)/1000` against `ttl`:
   - Fresh → hit, `hits++`, update LRU.
   - Expired but within `staleWhileRevalidate` → still served (stale),
     the caller revalidates in the background.
   - Older than that → entry deleted, miss.
4. **Cacheability** (`isCacheable`, static): only `GET`/`HEAD`, only 2xx
   statuses, and rejects `no-store`, `private`, `no-cache`.
5. **TTL** (`getTTL`): priority `s-maxage` → `max-age` → `defaultTTL` (300 seconds).
6. **Conditional request** (`checkConditional`): match `If-None-Match` (ETag,
   including `*` and lists) or `If-Modified-Since` against the entry — a successful
   comparison means 304, not a full body.
7. **Purge** (`purge(pattern)`): remove all keys matching the regex, returns the count.
8. **Statistics** (`getStats`): `hits`, `misses`, `hitRate`, `entries`, `size`,
   `evictions`.

### Configuration

No binding to `gateway.config.json` yet — the class is instantiated with
zero-config defaults (the same pattern as the observability features):

| Option | Default | Meaning |
|---|---|---|
| `maxSize` | `100 MB` | total cached body byte limit |
| `maxEntries` | `10000` | entry count limit |
| `defaultTTL` | `300` seconds | TTL when the upstream sends no `Cache-Control` |
| `enableStats` | `true` | collect hits/misses/evictions |

Planned as a `cache-control` plugin via `plugins[]`
(PLUGIN_CONFIG) — wiring into the plugin chain
doesn't exist in the code yet (see Status).

### Edge cases

| Trigger | Behavior | User-visible result |
|---|---|---|
| Response > `maxSize` | `set` returns `false`, nothing stored | Always a miss for that URL |
| `maxEntries` reached | Evict LRU until it fits | Old rarely-accessed entries disappear (hit rate drops, no error) |
| Expired entry + `stale-while-revalidate` | Served stale within the SWR window | Fast response but possibly stale |
| Expired entry past SWR | Deleted on `get` | Miss; upstream is re-requested |
| `Cache-Control: no-store` / `private` / `no-cache` | `isCacheable` → false | Never stored |
| Non-2xx status (including 301/302) | Not cacheable | Errors/redirects always go upstream |
| POST/PUT/DELETE | Not cacheable (method check) | Always goes upstream |
| `If-None-Match` matches a cached ETag | `checkConditional` → true | Caller gets 304, body not transferred |
| `Vary` value differs between requests | Part of the key hash | Two representations coexist |
| `purge(pattern)` with no match | Returns 0, no effect | Safe no-op |
| Process restart | Cache gone entirely | Cold cache; all requests go upstream (TRANSIENT by design) |
