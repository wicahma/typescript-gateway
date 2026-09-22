---
title: "Arsitektur & Pipeline"
description: "Mengintip ke dalam request pipeline tanpa dependency dan tanpa alokasi."
order: 2
section: "Architecture"
track: "guide"
---

# Arsitektur & Request Pipeline

## Filosofi Inti

1. **Tanpa Runtime Dependency**: Tidak ada Express, Fastify, Pino, atau Ajv. Semua logging, routing, validasi, dan proxy streaming hanya mengandalkan library standar Node.
2. **Hot Path Tanpa Alokasi**: Context, buffer parameter, dan metadata response didaur ulang pakai **Object Pool** di memori supaya V8 Garbage Collector tidak jeda.
3. **Resilience Dulu**: Circuit breaker, retry manager dengan exponential jitter, connection pooling, dan active health check adalah tahapan bawaan pipeline.
4. **Overhead Internal Sub-milidetik**: Dispatch route statis O(1), pencarian radix tree O(log n).

## Alur Request Lifecycle

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

## Komponen Utama

### 1. Radix Router (`src/core/router.ts`)
Menggabungkan hash table statis untuk hit langsung O(1) dan radix prefix tree terkompresi untuk route wildcard dinamis (`/users/:id`).

### 2. Upstream Connection Pool (`src/core/http-client-pool.ts`)
Menjaga koneksi socket tetap terbuka pakai `http.Agent` dengan TCP keep-alive yang dioptimalkan, mencapai tingkat pemakaian ulang socket 99,99% saat konkurensi tinggi.

### 3. Circuit Breaker (`src/core/circuit-breaker.ts`)
Mengimplementasikan state machine circuit breaker ala Michael Nygard / Martin Fowler per target upstream. Otomatis menghentikan traffic ke service yang gagal sebelum terjadi cascading outage.

### 4. Native Structured Logger (`src/utils/logger.ts`)
Structured JSON logger non-blocking yang menulis langsung ke `process.stdout.write` tanpa overhead logger pihak ketiga yang berat.
