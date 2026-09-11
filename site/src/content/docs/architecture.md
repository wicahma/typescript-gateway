---
title: "Architecture & Pipeline"
description: "Under the hood of the zero-dependency zero-allocation request pipeline."
order: 2
section: "Architecture"
---

# Architecture & Request Pipeline

## Core Philosophy

1. **Zero Runtime Dependencies**: No Express, Fastify, Pino, or Ajv. All logging, routing, validation, and proxy streaming rely solely on Node standard libraries.
2. **Zero-Allocation Hot Path**: Contexts, parameter buffers, and response metadata are recycled using an in-memory **Object Pool** to prevent V8 Garbage Collector pauses.
3. **Resilience First**: Circuit breaker, retry manager with exponential jitter, connection pooling, and active health checks are native pipeline stages.
4. **Sub-millisecond Internal Overhead**: O(1) static route dispatch, O(log n) radix tree lookup.

## Request Lifecycle Flow

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
Internal System Route           Proxy Route
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

## Key Components

### 1. Radix Router (`src/core/router.ts`)
Combines a static hash table for O(1) direct hits and a compressed radix prefix tree for dynamic wildcard routes (`/users/:id`).

### 2. Upstream Connection Pool (`src/core/http-client-pool.ts`)
Keeps socket connections open using `http.Agent` with optimized TCP keep-alive, achieving a 99.99% socket reuse rate under high concurrency.

### 3. Circuit Breaker (`src/core/circuit-breaker.ts`)
Implements the Michael Nygard / Martin Fowler circuit breaker state machine per upstream target. Automatically halts traffic to failing services before cascading outages occur.

### 4. Native Structured Logger (`src/utils/logger.ts`)
Non-blocking structured JSON logger writing directly to `process.stdout.write` without the overhead of heavy third-party loggers.
