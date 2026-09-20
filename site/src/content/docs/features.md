---
title: "Feature Matrix"
description: "All 24 features across 7 groups, with spec coverage (FSD + ERD) and implementation status."
order: 11
section: "Features"
---

# Feature Matrix

All 24 features in 7 groups. Every implemented feature ships with an FSD (functional spec) and ERD (data model) pair, plus unit and integration test coverage. 898/898 tests green at time of writing.

| Group | Feature | FSD | ERD | Status |
|---|---|---|---|---|
| Core Routing | Radix Router | ✓ | ✓ | implemented |
| Core Routing | Reverse Proxy Handler | ✓ | ✓ | implemented |
| Core Routing | Request Pipeline | ✓ | ✓ | implemented |
| Core Routing | Request Context Pool | ✓ | ✓ | implemented |
| Resilience | Circuit Breaker | ✓ | ✓ | implemented |
| Resilience | Retry Manager | ✓ | ✓ | implemented |
| Resilience | Health Checker | ✓ | ✓ | implemented |
| Resilience | Fallback Handler | ✓ | ✓ | implemented |
| Resilience | Timeout Manager | ✓ | ✓ | implemented |
| Traffic Control | Rate Limiter | ✓ | ✓ | implemented |
| Traffic Control | Response Cache | ✓ | ✓ | implemented |
| Traffic Control | Load Balancer | ✓ | ✓ | implemented |
| Payload | Body Parser | ✓ | ✓ | implemented |
| Payload | Request Transformer | ✓ | ✓ | implemented |
| Payload | Response Transformer | ✓ | ✓ | implemented |
| Payload | Compression Handler | ✓ | ✓ | implemented |
| Observability | Metrics Histogram | ✓ | ✓ | implemented |
| Observability | Native Structured Logger | ✓ | ✓ | implemented |
| Observability | Performance Dashboard | ✓ | ✓ | implemented |
| Observability | CPU & Memory Profiler | ✓ | ✓ | implemented |
| Operations | Config Loader & Validator | ✓ | ✓ | implemented |
| Operations | Plugin Execution Chain | ✓ | ✓ | implemented |
| Operations | Auto Tuner | ✓ | ✓ | implemented |
| Identity & Security | JWT Auth Plugin | ✓ | ✓ | implemented |
| Identity & Security | API Key Engine | ✓ | ✓ | implemented |
| Identity & Security | Upstream Credential Injection | ✓ | ✓ | implemented |
| Identity & Security | RFC 7807 Problem Details | ✓ | — | implemented |

## Benchmarks

Measured on the homelab target (4-core i5-6500T, Node 22):

| Scenario | Result | Target |
|---|---|---|
| Hot target path (load-test, 100 conn) | **P99 5ms · 38,405 RPS** | P99 < 10ms · RPS > 10k ✓ |
| acquire+release pool overhead | 1.5 µs/op | — |
| Circuit breaker CLOSED fast-path | ~1.1 µs/req saved | — |
| Full proxy path @ 100 conn | ~3.2k RPS · P99 ~40ms | hardware-bound ceiling* |

\* The full-proxy ceiling is loopback round-trip bound on a shared 4-core box (raw url-forward hop alone measures 223 µs/op), not code overhead — gateway code above the raw hop is ~28%. Documented honestly; not chased further.
