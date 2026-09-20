---
title: "Core Routing & Proxy (F1)"
description: "Radix router, reverse proxy pipeline, policy chaining, and zero-allocation context pooling."
order: 4
section: "Features"
---

All 4 features in this group are **implemented and verified** — each has a full FSD + ERD spec pair and unit/integration coverage in the repo test suite.

## Radix Router

The Radix Router is the gateway's route-matching engine. Its goal: map an incoming
HTTP `method + path` to a single `RouteHandler` as fast as possible, using two
complementary lookup paths:

- **Static routes** (no `:` or `*`) live in `Map<HttpMethod, Map<path, handler>>` — **O(1)** lookup.
- **Dynamic routes** (`:param`, `*` wildcard) live in a **radix tree** per method — **O(log n)** lookup relative to the number of segments, not the number of routes.

Implementation: `src/core/router.ts` (250 lines), the `Router` class. Zero dependencies —
just `Map`, `split`, and plain recursion; no regex, no external library
(per the project's zero-dependency principle: `node:http`, `node:crypto`, no Express).

### Configuration

| Source | Field | Effect |
|---|---|---|
| `routes[]` in `config/gateway.config.json` | `method`, `path`, `handler ref`, `priority` | `ROUTE` source (PERSISTED); read once at boot |
| `server{}` | `requestTimeout` | Not part of the router, but used by the `Server` that calls `router.match` |
| — | `Router.clear()` | Clears all Maps + tree (used by tests / hot-reload path) |

There is no runtime configuration for the router itself: the data structures are fixed in the
constructor (7 HTTP methods: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS).

### Edge cases

| Trigger | Behavior | User-visible result |
|---|---|---|
| Path matches nothing | `match` returns `null` | `Server` sends 404 `Not Found` |
| Two dynamic routes compete for the same segment (`:id` vs `:userId` at the same position) | Only one `paramChild` node; the param name from the **first** registration wins | First param name is what the handler sees |
| Wildcard not the last segment (e.g. `/files/*/edit`) | `insertRadix` breaks at `*`; remaining segments ignored during insert | Wildcard stays terminal; documented behavior, avoid this pattern |
| Path with trailing slash (`/api/users/`) | `filter(s => s.length > 0)` drops empty segments | `/api/users` and `/api/users/` are equivalent |
| Query string in the URL | `Server` splits off `?query` before `router.match` | Router only receives the pure path |
| Method not in the 7-method enum | No Map/tree exists for it | Match `null` → 404 |
| Dynamic-segment backtrack fails (`/a/:x/b` vs request `/a/1/c`) | Param is `delete`d, walk falls back to wildcard/`null` | 404 without leaking params |


## Request Context Pool

The Request Context Pool provides `RequestContext` objects that are **reused across
requests** to reduce GC pressure. Every incoming HTTP request needs a context
(requestId, method, path, headers, body, timestamps, etc.); without pooling, each
request allocates a new object → memory churn → GC jank. The pool pre-allocates.

Implementation:
- `src/core/context.ts` (185 lines) — `PoolableRequestContext` + `ContextPool` + `PoolMetrics`.
- `src/utils/pool.ts` (247 lines) — generic `ObjectPool<T>` + `BufferPool` (byte-buffer reuse).
- `src/core/cleanup-manager.ts` (427 lines) — `CleanupManager`: per-request resource tracking (timers, streams, event listeners, AbortControllers), leak detection, guaranteed cleanup.

Zero-dependency: only JS structures (`Array.pop`, `Set`) — no external pooling library.

### How it works

```
request arrives (Server.handleRequest)
  │
  ├─ ctx = contextPool.acquire()          ← pool.pop(); hit → reuse, miss → new
  ├─ populate ctx: requestId, startTime (hrtime.bigint), method, path, headers, req, res
  ├─ parse query (lazy, only when '?' present)
  ├─ match = router.match(method, path)   → ctx.params, ctx.route (setRoute)
  ├─ preRouteHook(ctx) → handler(ctx)     → sendResponse if not yet
  │
  └─ finally:
       metrics.recordLatency(startTime)
       logger.info({requestId, method, path, status, durationMs})
       contextPool.release(ctx)           ← inUse.delete → ctx.reset() → pool.push (if < maxSize)
```

`PoolableRequestContext.reset()` clears 14 fields (requestId, startTime, method,
path, query, params, headers, body, req, res, upstream, state, responded, route,
timestamps) — no request state can leak into the next request.

`ContextPool` (default `initialSize = 1000`):
- `acquire()` — `pool.pop()`; hit → `hits++`; pool empty → `misses++` + `new PoolableRequestContext()` (overflow object, GC'd on release above maxSize).
- `release(ctx)` — double-release guard (`inUse.has`), `ctx.reset()`, `pool.push` only when `pool.length < maxSize`.
- `metrics()` — `{ size, available, inUse, hits, misses, totalAcquired }`; `getHitRate()` = hits/totalAcquired × 100.

`ObjectPool<T>` (generic, `src/utils/pool.ts`) follows the same pattern for any object with
a `reset()`; `BufferPool` pools `Buffer`s per size (default 8192 B, 100 per size)
with a `WeakMap<Buffer, wrapper>` for safe release.

`CleanupManager` complements pooling: resources attached to a single request
(`trackTimer`, `trackStream`, `trackEventListener`, `trackAbortController`)
are tracked per `requestId`; `cleanupRequest(requestId)` runs them all via
`Promise.all`; periodic leak detection (60 s interval, `unref()`) flags resources
active for > `leakDetectionThreshold` (default 60 s, enabled in `NODE_ENV=development`).

### Configuration

| Source | Field | Default | Effect |
|---|---|---|---|
| Code (`Server` constructor) | `ContextPool(1000)` | 1000 | Request-context pool size (not yet exported to the config file) |
| `CleanupConfig` | `enableLeakDetection` | `NODE_ENV === 'development'` | Periodic leak scanner |
| `CleanupConfig` | `leakDetectionThreshold` | 60000 ms | Resource age above which it counts as a leak |
| `CleanupConfig` | `autoCleanupOnTimeout` | `true` | Automatic cleanup on timeout |
| `CleanupConfig` | `enableMetrics` | `true` | `totalCleanupTime`/`avgCleanupTime` stats |
| `ObjectPool` | `size` | 100 | Generic pool size / per-size BufferPool |
| `BufferPool` | `defaultSize` | 8192 | Default buffer size |

### Edge cases

| Trigger | Behavior | User-visible result |
|---|---|---|
| 1000+ concurrent requests | Pool empty → `misses++`, new context allocated | Still served; overflow objects GC'd on release above maxSize |
| `release` called twice for the same ctx | Guard `inUse.has(ctx)` → no-op return | No duplication in the pool |
| Handler forgets to clear a field (e.g. `ctx.state`) | `reset()` clears everything on release | No data leakage between requests |
| Orphaned timer/stream on request error | `cleanupRequest(requestId)` in the application `finally` path | Resource closed; event loop not kept alive |
| Resource active > 60 s (dev mode) | `detectLeaks()` every 60 s + `logger.warn` | Operator sees potential leak in the log |
| `cleanup()` throws | Caught + `logger.error`; resource still removed from tracking | One failing resource doesn't drop the others |
| Shutdown after drain timeout | `Server` force-destroys remaining sockets (`socket.destroy()`) | Connections don't hold up shutdown |


## Request Pipeline

The Request Pipeline is the gateway's policy-chaining layer (M2 migration). Its goal:
provide a single execution point for **inbound policies** (auth, cache, rate limit —
may short-circuit a request before it reaches the backend) and **outbound policies**
(response transformation before it is sent to the client), replacing the ad-hoc
`preRouteHook` in `Server`.

Implementation:

| File | Contents |
|---|---|
| `src/pipeline/policy.ts` (16 lines) | `GatewayPolicy` interface (`name`, optional `executeInbound`/`executeOutbound`), `OutboundResponse` type |
| `src/pipeline/request-pipeline.ts` (56 lines) | `RequestPipeline` class: `register`, `runInbound`, `runOutbound`, `static writeResponse` |
| `src/core/url-forward.ts` (93 lines) | `UrlForwarder` — pure upstream forwarding, extracted from `ProxyHandler.proxyRequest` (monolith 560 → 490 lines) |
| `src/core/response-cache-policy.ts` (79 lines) | `ResponseCachePolicy` — first real consumer of `ResponseCache` (previously dead code) |
| `src/plugins/builtin/auth-jwt-policy.ts` (150 lines) | `AuthJwtPolicy` — JWT verification as a policy; returns a problem `Response`, identity into `ctx.state.user` |

Zero external dependencies. **Status: implemented** — commit `99fd7d5` (M2),
`npm test` 790/790 passing.

### How it works

```
Client → Server → ContextPool → Radix Router
      → Pipeline.runInbound  (policies in order)
            AuthJwtPolicy    → invalid JWT: 401 problem+json → short-circuit
            ResponseCachePolicy → HIT: cached Response      → short-circuit
            (all pass / void) → null → continue
      → ProxyHandler (UrlForwarder → upstream)
      → Pipeline.runOutbound (composition chain over OutboundResponse)
      → RequestPipeline.writeResponse → ServerResponse → Client
```

1. **`register(policy)`** — adds a policy; duplicate names are rejected
   (`Duplicate policy name: …`). Registration order = execution order
   (`src/index.ts`: `AuthJwtPolicy` first, then `ResponseCachePolicy`).
2. **`runInbound(ctx)`** — runs `executeInbound` on every policy that has the
   hook. The first returned `Response` = **short-circuit**: returned to `Server`,
   the rest of the chain and the handler are skipped. All `void`/no hook → `null` → continue
   to `ProxyHandler`.
3. **Short-circuit write** — `RequestPipeline.writeResponse(res, response)`
   (static): copies `status` + headers from the Web `Response` to the `ServerResponse`,
   writes the body once (no `headersSent` race).
4. **`UrlForwarder`** — forwards the request to the upstream (pure function, no
   policy logic) — called by `ProxyHandler` after all inbound policies pass.
5. **`runOutbound(ctx, response)`** — composition chain: each `executeOutbound`
   may replace the `OutboundResponse` (`{ statusCode, headers, body? }`);
   the last policy's result is what gets written. Policy errors never write directly to the
   socket — they come back as a problem `Response` via the same mechanism.

### Configuration

No new `gateway.config.json` fields for the pipeline itself. Wiring happens
in `src/index.ts`:

- `auth` (object, optional) in config → `AuthJwtPolicy` is registered.
- `ResponseCachePolicy` is always registered (uses the F3 `ResponseCache`).
- `Server.setPipeline(pipeline)` — replaces `preRouteHook` (removed).

Policy registration is programmatic (TypeScript), not declarative —
declarative policy arrays remain YAGNI (see index).

### Edge cases

| Trigger | Behavior | User-visible result |
|---|---|---|
| Two policies with the same `name` | `register` throws before serving | Fast boot failure, not silent |
| Cache HIT | Cached `Response` goes straight to `writeResponse` | Upstream untouched; `x-cache: HIT` header (MISS when forwarded) |
| Invalid/expired JWT | `AuthJwtPolicy` returns a 401 problem | `application/problem+json`, upstream not consumed |
| Inbound policy without `executeInbound` | Skipped (`continue`) | Outbound-only policies mix in safely |
| Outbound policy returns `void` | `current` is kept | Composition chain optional per policy |
| Policy response when headers already sent | `writeResponse` is only called from the single `Server` path | No double-write `headersSent` |


## Reverse Proxy Handler

The Reverse Proxy Handler is the heart of the gateway's forwarding: after the `Radix-Router`
finds a route, this handler forwards the request to the upstream, returns the
response to the client, and installs resilience guards along the way (circuit
breaker, health checks, load balancing, transformation, compression).

Implementation: `src/core/proxy-handler.ts` (560 lines, the `ProxyHandler` class) —

modularization is the **M2** plan and is documented in
[Out of Scope (YAGNI)]](#out-of-scope-yagni), not as something that already exists.
Zero-dependency: `node:http`, `node:https`, no undici/axios/http-proxy.

### How it works

The `ProxyHandler.handle(ctx)` pipeline — 8 deterministic steps:

```
handle(ctx)
  │
  ├─ 1. Size check        content-length > maxRequestSize (default 10 MB) → throw
  ├─ 2. Request transform  RequestTransformer.transform(method, path, headers, body)
  ├─ 3. Body parse         BodyParser.parse(req) for POST/PUT/PATCH + content-length > 0
  ├─ 4. LB select          LoadBalancer.select({clientIp, path}) → upstream
  │                        (throw 'No healthy upstream available' when empty)
  ├─ 5. Circuit + proxy    CircuitBreaker.execute(proxyRequest) per upstream
  │     │
  │     └─ proxyRequest:   HttpClientPool.acquire(upstream) → keep-alive agent
  │                        http/https.request({host, port, basePath+path, agent})
  │                        buffer full response (chunks → Buffer.concat)
  │                        release agent back to pool; remove on error/timeout
  ├─ 6. Response transform ResponseTransformer.transform(path, status, headers, body)
  ├─ 7. Compression        shouldCompress(contentType, size, accept-encoding)
  │                        → negotiateAlgorithm → compress → addCompressionHeaders
  └─ 8. Send               res.writeHead(status, headers); res.write(body); res.end()
                           + recordLatency, passive health check, advanced metrics
```

Error path: any error before the response is sent is mapped —
`timeout` → 504 `gateway_timeout`, `no healthy upstream` → 503 `service_unavailable`,
everything else → 502 `bad_gateway` (JSON body `{ error: { code, message } }`).

### Configuration

`ProxyHandlerConfig` (constructor override of `DEFAULT_CONFIG`):

| Field | Default | Effect |
|---|---|---|
| `enableBodyParsing` | `true` | Parse POST/PUT/PATCH bodies via `BodyParser` |
| `enableCircuitBreaker` | `true` | One `CircuitBreaker` per upstream id |
| `enableHealthChecking` | `true` | `HealthChecker.start(upstreams)` + passive check per request |
| `requestTimeout` | `30000` ms | Request timeout toward the upstream |
| `enableRequestTransformations` | `true` | Header/path/body rewrite before forwarding |
| `enableResponseTransformations` | `true` | Response rewrite before sending |
| `enableCompression` | `true` | gzip/brotli/deflate via `CompressionHandler` |
| `enableAdvancedMetrics` | `true` | `AdvancedMetrics.record*` for route/upstream/error |
| `maxRequestSize` | 10 MB (10485760) | Reject oversized requests (step 1) |
| `maxResponseSize` | 50 MB (52428800) | Response buffer limit |
| `maxHeaderSize` | 16 KB (16384) | Header size limit |

`UPSTREAM` source (PERSISTED): `upstreams[]` in `config/gateway.config.json` —
`id, protocol, host, port, basePath, poolSize, timeout, healthCheck{}, weight`.
Injected via `ProxyHandler.initialize(upstreams)`.

### Edge cases

| Trigger | Behavior | User-visible result |
|---|---|---|
| `content-length` > `maxRequestSize` | `throw 'Request size exceeds limit'` before forwarding | 502 (`bad_gateway` mapping) — oversize also prevented earlier by `Server` (413) |
| All upstreams unhealthy | `LoadBalancer.select` returns null | 503 `service_unavailable` |
| Upstream timeout (`requestTimeout`) | `proxyReq.destroy()`, agent `remove`d from pool, throw | 504 `gateway_timeout` |
| Upstream error mid-stream | `proxyRes.on('error')` → agent removed, reject | 502 `bad_gateway` |
| Circuit breaker OPEN | `breaker.execute` short-circuits without touching the upstream | Fast error, details in F2 Circuit-Breaker |
| Body without `content-length` (chunked) | `shouldParseBody` false; body still forwarded when `ctx.body` exists | Forwarding continues |
| Compressible response (large JSON + `accept-encoding: gzip`) | Negotiate + compress + `Content-Encoding` header | Compressed response; ratio metric recorded |
| Client IP for LB `ip-hash` | `X-Forwarded-For` → `X-Real-IP` → `socket.remoteAddress` (in order) | Sticky routing per IP |
| `shutdown()` called | `healthChecker.stop()` + `clientPool.destroy()` | Upstream connections closed cleanly |
