---
title: "Core Routing & Proxy"
description: "Radix router, reverse proxy pipeline, policy chaining, and zero-allocation context pooling."
---

Every feature in this group is **implemented and verified**, each with unit and integration coverage in the repo test suite.

## What It Does

The core routing and proxy layer comprises the primary HTTP routing, context management, and upstream proxy pipeline of TypeScript Gateway.

### Radix Router

The Radix Router is the gateway's route-matching engine. Its goal: map an incoming HTTP `method + path` to a single `RouteHandler` as fast as possible, using two complementary lookup paths:

- **Static routes** (no `:` or `*`) live in `Map<HttpMethod, Map<path, handler>>` — **O(1)** lookup.
- **Dynamic routes** (`:param`, `*` wildcard) live in a **radix tree** per method — **O(log n)** lookup relative to the number of segments, not the number of routes.

Implementation: `src/core/router.ts`, the `Router` class. Zero dependencies — just `Map`, `split`, and plain recursion; no regex, no external library.

### Request Context Pool

The Request Context Pool provides `RequestContext` objects that are **reused across requests** to reduce GC pressure. Every incoming HTTP request needs a context (requestId, method, path, headers, body, timestamps, etc.); without pooling, each request allocates a new object, causing memory churn and GC pauses. The pool pre-allocates these structures.

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

`PoolableRequestContext.reset()` clears 14 fields (requestId, startTime, method, path, query, params, headers, body, req, res, upstream, state, responded, route, timestamps) so no request state can leak into subsequent requests.

### Request Pipeline & Policy Chaining

The Request Pipeline is the gateway's policy-chaining layer. It provides a single execution point for **inbound policies** (auth, cache, rate limit — which may short-circuit a request before it reaches the backend) and **outbound policies** (response transformation before it is sent to the client).

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

1. **`register(policy)`**: Adds a policy; duplicate names are rejected. Registration order equals execution order.
2. **`runInbound(ctx)`**: Runs `executeInbound` on every policy. The first returned `Response` short-circuits execution.
3. **Short-circuit write**: `RequestPipeline.writeResponse(res, response)` copies status and headers to `ServerResponse` and writes the body without headersSent race conditions.
4. **`UrlForwarder`**: Forwards the request to the upstream target after inbound policies pass.
5. **`runOutbound(ctx, response)`**: Runs `executeOutbound` across registered policies to transform the outbound response.

### Reverse Proxy Handler

The `ProxyHandler.handle(ctx)` pipeline coordinates 8 deterministic steps:

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

### WebSocket Tunneling

Opt-in `Upgrade` handling: when `proxy.enableWebSocket` is set, the proxy handler completes the WebSocket handshake against the selected upstream, writes the `101 Switching Protocols` response to the client, and pipes both sockets bidirectionally as a raw byte pipe.

### Auxiliary Utilities

- **OpenAPI Generator (`src/core/openapi-generator.ts`)**: Emits OpenAPI 3 specifications over the live route table with parameter and server mapping.
- **Client Disconnect Propagation**: Proxied requests attach an `AbortController` bound to the client socket `close` event, halting in-flight upstream fetches if the caller disconnects.
- **Request Coalescing (Single-Flight)**: `UrlForwarder.share()` collapses concurrent identical GET/HEAD requests into a single upstream fetch.
- **Streaming Response Path**: `ProxyHandlerConfig.streamingThreshold` streams GET/HEAD responses above threshold size directly to the client without buffering.

## Configuration

Core routing and proxy behavior is controlled via the following options:

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `routes[].method` | string | — | HTTP method to register in the router. |
| `routes[].path` | string | — | URL path pattern (`/static`, `/users/:id`, `/files/*`). |
| `routes[].priority` | number | `0` | Route match precedence order. |
| `server.requestTimeout` | number | `30000` | Inbound request timeout in milliseconds. |
| `proxy.enableWebSocket` | boolean | `false` | Enables HTTP 101 Switching Protocols WebSocket tunneling. |
| `proxy.streamingThreshold` | number | `0` | Byte threshold to bypass buffering and stream responses directly. |
| `proxy.enableBodyParsing` | boolean | `true` | Parses POST/PUT/PATCH request payloads. |
| `proxy.enableCircuitBreaker` | boolean | `true` | Enforces circuit breaker limits per upstream. |
| `proxy.enableHealthChecking` | boolean | `true` | Enables active and passive health checks for upstreams. |
| `proxy.maxRequestSize` | number | `10485760` | Rejects incoming request payloads larger than this limit (bytes). |
| `proxy.maxResponseSize` | number | `52428800` | Response buffer limit (50 MB). |
| `proxy.maxHeaderSize` | number | `16384` | Maximum allowable header size in bytes. |

## Interactions

Core routing coordinates with the rest of the gateway pipeline in the following sequence:

1. **Router Resolution**: The `RadixRouter` resolves the route path and binds URL parameters (`ctx.params`).
2. **Inbound Policy Enforcement**: `RequestPipeline.runInbound` runs auth, caching, and rate limiting sequentially. If a policy returns a `Response`, execution short-circuits and skips upstream forwarding.
3. **Load Balancer Selection**: Filters healthy upstream candidates from `HealthChecker` and picks an endpoint using the configured load balancing algorithm.
4. **Circuit Breaker Check**: Verifies the target upstream is `CLOSED` or canary `HALF-OPEN` before leasing an HTTP connection.
5. **Upstream Forwarding & Outbound Policies**: Transports the request over `HttpClientPool`, applies response transformations through `runOutbound`, and flushes compressed bytes to the client.

## Tradeoffs and Failure Modes

### Memory Pooling vs Allocation Spikes

Pre-allocating contexts (`ContextPool(1000)`) eliminates GC pauses under steady high throughput. If concurrent requests exceed pool capacity, the pool allocates temporary objects outside the pool. Once released, overflow objects are garbage-collected normally.

### Upstream Degradation and Timeouts

- **Upstream Timeout**: If an upstream fails to reply within `requestTimeout`, the socket is destroyed, removed from the pool, and the gateway returns a `504 Gateway Timeout`.
- **All Upstreams Unhealthy**: If the load balancer finds no healthy upstream instances, the gateway responds with `503 Service Unavailable`.
- **Client Disconnect**: If the client closes the connection during streaming, an `AbortSignal` terminates the upstream request immediately to prevent wasted resource consumption.

### Edge Case Matrix

| Scenario | Behavior | Response / Outcome |
| --- | --- | --- |
| Route not found | `match` returns `null` | 404 Not Found |
| Two dynamic routes compete for same segment | First registered param name wins | Deterministic parameter assignment |
| Oversized request body | `content-length > maxRequestSize` | 413 Payload Too Large / 502 Bad Gateway |
| Upstream error mid-stream | Socket emits error, agent removed | 502 Bad Gateway |
| Duplicate policy name registered | Pipeline throws on registration | Process crashes fast at boot time |
