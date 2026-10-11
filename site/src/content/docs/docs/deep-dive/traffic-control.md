---
title: "Traffic Control"
description: "Rate limiting, response caching, and load balancing across upstreams."
---

Every feature in this group is **implemented and verified**, each with unit and integration coverage in the repo test suite.

## What It Does

Traffic control governs the flow, volume, and distribution of requests across backend instances and protects backends from saturation.

### Load Balancer

The Load Balancer selects one healthy upstream for every incoming request. Five algorithms are selectable:
- **`round-robin`** (default): Cyclic sequential distribution (`index % n`).
- **`least-connections`**: Routes to the backend instance with the smallest active connection count.
- **`weighted-round-robin`**: Allocates virtual slots based on `weight` configuration (e.g. weight 3 gets 3× more requests).
- **`ip-hash`**: Hashes client IP (`md5(clientIp)`) for sticky sessions. Falls back to round-robin when client IP is absent.
- **`random`**: Distributes traffic uniformly at random.

### Rate Limiter

The Rate Limiter enforces request ceilings per client IP, per API key, or per route to prevent abuse and capacity exhaustion:
- **Token Bucket (`TokenBucketRateLimiter`)**: Maintains a burst capacity of tokens, refilled at a fixed rate per second.
- **Sliding Window Counter (`SlidingWindowRateLimiter`)**: Tracks request timestamps in discrete sliding time buckets to ensure accurate window boundaries.
- **Headers & Problem JSON**: Injected RFC 6585 headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`) and HTTP 429 problem payloads when limits are breached.

### Response Cache

The Response Cache holds cacheable HTTP responses in memory to serve repeated GET/HEAD requests with zero upstream latency:
- **Key Generation & Vary Handling**: Keys are computed via `sha256(method | url | sorted varyHeaders)`. Separate variants are tracked for headers like `Accept-Encoding`.
- **LRU Eviction**: Bounded memory capacity with LRU eviction when reaching `maxEntries` or `maxSize`.
- **Stale-While-Revalidate (SWR)**: Serves cached responses during background revalidation windows with `x-cache: STALE`.
- **Conditional Revalidation**: Supports `If-None-Match` (ETag) and `If-Modified-Since` (304 Not Modified negotiation).

## Configuration

Traffic control settings are defined in the `server`, `upstreams`, and `performance` blocks:

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `upstreams[].weight` | number | `1` | Relative traffic weight for weighted round-robin. |
| `loadBalancer.strategy` | string | `"round-robin"` | Selection algorithm (`round-robin`, `least-connections`, `weighted-round-robin`, `ip-hash`, `random`). |
| `loadBalancer.healthAware` | boolean | `true` | Excludes unhealthy upstreams from target selection. |
| `rateLimit.capacity` | number | `100` | Maximum token burst capacity for token bucket limiters. |
| `rateLimit.refillRate` | number | `10` | Tokens replenished per second. |
| `rateLimit.windowMs` | number | `60000` | Window duration in milliseconds for sliding window limiters. |
| `responseCache.enabled` | boolean | `true` | Enables inbound response caching. |
| `responseCache.ttlSeconds` | number | `300` | Fallback cache time-to-live when Cache-Control is absent. |
| `responseCache.maxSize` | number | `104857600` | Total cache storage limit in bytes (100 MB). |
| `responseCache.maxEntries` | number | `10000` | Maximum number of cached responses held in memory. |

## Interactions

Traffic control components execute at distinct checkpoints along the pipeline:

1. **Inbound Rate Limiting**: Executes during the `preRoute` plugin and inbound policy phase. Breached limits return HTTP 429 immediately.
2. **Cache Lookup**: `ResponseCachePolicy` runs before forwarding. A cache hit short-circuits execution and returns the stored payload (`x-cache: HIT`).
3. **Upstream Selection**: `LoadBalancer.select()` filters healthy upstreams using `HealthChecker` state and resolves the destination socket.
4. **Outbound Cache Capture**: Cacheable responses (HTTP 200, GET/HEAD, valid `Cache-Control`) are captured, indexed, and stored in the memory cache.

## Tradeoffs and Failure Modes

- **Memory Caps & Eviction**: Both the Rate Limiter and Response Cache store state in-memory. Under extreme unique-client cardinality, LRU eviction discards the oldest buckets. Discarded rate limit keys restart quotas, preventing out-of-memory crashes at the expense of transient quota resets.
- **Cache Invalidation & Freshness**: In-memory caching provides high throughput but is local to the node. Process restarts clear cache data, resulting in a cold-cache period.
- **Sticky Session Imbalance with IP Hashing**: If a significant volume of traffic originates from a corporate proxy or NAT gateway sharing a single client IP, `ip-hash` routes all that traffic to a single backend node.
- **Fail-Safe Behavior**: If all upstream targets fail health checks, `LoadBalancer.select()` returns `null`, and the gateway emits an immediate 503 Service Unavailable rather than hanging.
