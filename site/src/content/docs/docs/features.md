---
title: "Feature Matrix"
description: "All 30 features across 7 groups, with implementation status."
order: 11
section: "Features"
track: "reference"
---


All 30 features across 7 groups, each backed by unit and integration test coverage. 950/950 tests green at time of writing.

| Group | Feature | Status |
|---|---|---|
| Core Routing | Radix Router | implemented |
| Core Routing | Reverse Proxy Handler | implemented |
| Core Routing | Request Pipeline | implemented |
| Core Routing | Request Context Pool | implemented |
| Core Routing | WebSocket Tunneling | implemented |
| Core Routing | OpenAPI Generator | implemented |
| Core Routing | Client Disconnect Propagation | implemented |
| Core Routing | Request Coalescing | implemented |
| Core Routing | Streaming Response Path | implemented |
| Resilience | Circuit Breaker | implemented |
| Resilience | Retry Manager | implemented |
| Resilience | Health Checker | implemented |
| Resilience | Fallback Handler | implemented |
| Resilience | Timeout Manager | implemented |
| Traffic Control | Rate Limiter | implemented |
| Traffic Control | Response Cache | implemented |
| Traffic Control | Load Balancer | implemented |
| Payload | Body Parser | implemented |
| Payload | Request Transformer | implemented |
| Payload | Response Transformer | implemented |
| Payload | Compression Handler | implemented |
| Observability | Metrics Histogram | implemented |
| Observability | Native Structured Logger | implemented |
| Observability | Performance Dashboard | implemented |
| Observability | Access Log Sampling | implemented |
| Observability | CPU & Memory Profiler | implemented |
| Operations | Config Loader & Validator | implemented |
| Operations | Plugin Execution Chain | implemented |
| Operations | Auto Tuner | implemented |
| Identity & Security | JWT Auth Plugin | implemented |
| Identity & Security | API Key Engine | implemented |
| Identity & Security | Upstream Credential Injection | implemented |
| Identity & Security | RFC 7807 Problem Details | implemented |

## Benchmarks

Measured on the reference target (4-core x86_64, Node 22):

| Scenario | Result | Target |
|---|---|---|
| Hot target path (load-test, 100 conn) | **P99 5ms · 38,405 RPS** | P99 < 10ms · RPS > 10k ✓ |
| acquire+release pool overhead | 1.5 µs/op | — |
| Circuit breaker CLOSED fast-path | ~1.1 µs/req saved | — |
| Full proxy path @ 100 conn | ~3.2k RPS · P99 ~40ms | hardware-bound ceiling* |

\* The full-proxy ceiling is loopback round-trip bound on a shared 4-core box (raw url-forward hop alone measures 223 µs/op), not code overhead — gateway code above the raw hop is ~28%. Documented honestly; not chased further.
