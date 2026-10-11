---
title: "Architecture & Pipeline"
description: "Under the hood of the zero-dependency zero-allocation request pipeline."
---

## What It Does

TypeScript Gateway runs a zero-runtime-dependency HTTP reverse proxy engine designed around a zero-allocation request lifecycle. Key architectural pillars include:

1. **Zero Runtime Dependencies**: Relies strictly on Node standard libraries (`node:http`, `node:crypto`, `node:stream`).
2. **Zero-Allocation Hot Path**: Contexts, parameter buffers, and response metadata are recycled using an in-memory Object Pool to prevent V8 Garbage Collector pauses.
3. **Resilience First**: Circuit breaker, retry manager with exponential jitter, connection pooling, and active health checks are native pipeline stages.
4. **Sub-millisecond Internal Overhead**: O(1) static route dispatch, O(log n) radix tree lookup.

### Request Lifecycle Flow

```
Incoming Client Request
        │
        ▼
[ node:http Server (Keep-Alive Pool) ]
        │
        ▼
[ Context Pool (Acquire RequestContext) ]
  • High-resolution timestamp
  • Request ID generation
  • Parameter maps reset
        │
        ▼
[ Radix Tree Router ]
  • Exact match O(1)
  • Parametric segment O(log n)
        │
   ┌────┴───────────────────────────┐
   ▼                                ▼
Built-in Route                  Proxy Route
(/health, /metrics, /)          (/api/*, custom)
Direct Response                     │
                                    ▼
                        [ Plugin Chain: preRoute ]
                        • Rate Limiter (Token bucket / Sliding window)
                        • Request ID injection
                                    │
                                    ▼
                        [ Request Transformer ]
                        • Header injection / removal
                        • Path prefix rewriting
                                    │
                                    ▼
                        [ Load Balancer (5 Algorithms) ]
                        • Round Robin, Least Conn, Weighted, IP Hash, Random
                        • Filter healthy targets only
                                    │
                                    ▼
                        [ Circuit Breaker Guard ]
                        • CLOSED -> Forward
                        • OPEN -> Instant 503 / Fallback
                        • HALF-OPEN -> Probe canary
                                    │
                                    ▼
                        [ HTTP Client Connection Pool ]
                        • Stream request body
                        • Exponential Retry with Jitter on failure
                                    │
                                    ▼
                        [ Response Transformer & Compression ]
                        • Status code mapping
                        • Native gzip / brotli / deflate stream
                                    │
                                    ▼
                        [ Release to Client ]
                                    │
                                    ▼
[ Context Pool (Recycle RequestContext) ]
[ Metrics Aggregator: Record Latency ]
```

### Key Components

- **Radix Router (`src/core/router.ts`)**: Combines a static hash table for O(1) direct hits and a compressed radix prefix tree for dynamic wildcard routes (`/users/:id`).
- **Upstream Connection Pool (`src/core/http-client-pool.ts`)**: Keeps socket connections open using `http.Agent` with optimized TCP keep-alive, achieving high socket reuse rates under load.
- **Circuit Breaker (`src/core/circuit-breaker.ts`)**: Implements the circuit breaker state machine per upstream target, halting traffic to failing services.
- **Native Structured Logger (`src/utils/logger.ts`)**: Non-blocking structured JSON logger writing directly to `process.stdout.write`.

## Configuration

Architecture parameters are configured within the `server` and `performance` blocks of `gateway.config.json`:

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `server.port` | number | `3000` | Port where the gateway HTTP server listens for incoming connections. |
| `server.host` | string | `"0.0.0.0"` | Host address or network interface to bind the HTTP server. |
| `server.keepAlive` | boolean | `true` | Enables persistent TCP keep-alive connections on client sockets. |
| `server.keepAliveTimeout` | number | `65000` | Time in milliseconds before closing idle keep-alive client sockets. |
| `server.requestTimeout` | number | `30000` | Maximum time in milliseconds before terminating an inbound request. |
| `server.maxHeaderSize` | number | `16384` | Maximum allowable size in bytes for inbound HTTP request headers. |
| `server.maxBodySize` | number | `10485760` | Maximum allowable size in bytes for inbound request bodies (10 MB). |
| `performance.contextPoolSize` | number | `1000` | Number of pre-allocated `RequestContext` objects held in memory. |
| `performance.enablePooling` | boolean | `true` | Enables memory pooling and object recycling for incoming requests. |

## Interactions

The architecture establishes the ordering and boundaries of the entire request pipeline:

1. **Ingress**: `node:http.Server` parses HTTP headers and dispatches sockets to the pipeline.
2. **Context Lease**: `RequestContextPool` leases an initialized context, recording the start timestamp.
3. **Routing**: `RadixRouter` determines matching routes and upstream destinations.
4. **Pre-processing**: Registered plugins execute inbound lifecycle hooks (`preRoute`, `preHandler`).
5. **Upstream Forwarding**: `HttpClientPool` streams the request body to the selected upstream target.
6. **Post-processing**: Compression and response transformation hooks execute before flushing bytes to the client.
7. **Context Recycle**: The context is scrubbed of request data and returned to the pool, triggering metric recording.

## Tradeoffs and Failure Modes

- **Memory Pools vs Dynamic Allocation**: Object pools prevent V8 garbage collection pauses under high throughput. If the active concurrent request count exceeds `contextPoolSize`, the gateway dynamically allocates temporary unpooled contexts, falling back to standard garbage collection until the traffic spike subsides.
- **Upstream Connection Saturation**: Socket pools bound concurrency per backend. When an upstream slows down, client requests queue behind available sockets until reaching `requestTimeout`, at which point the gateway issues a 504 Gateway Timeout.
- **Socket Hang-ups and Aborts**: If a client disconnects prematurely, the gateway detects the abort event, cancels upstream streaming, and immediately releases pooled resources.
