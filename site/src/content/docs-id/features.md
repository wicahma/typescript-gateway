---
title: "Feature Matrix"
description: "Semua 30 fitur di 7 grup, dengan cakupan spek (FSD + ERD) dan status implementasi."
order: 11
section: "Features"
track: "reference"
---

Semua 30 fitur di 7 grup. Setiap fitur yang diimplementasikan dikirim dengan pasangan FSD (spek fungsional) dan ERD (model data), plus coverage tes unit dan integration. 918/918 tes hijau saat penulisan.

| Group | Feature | FSD | ERD | Status |
|---|---|---|---|---|
| Core Routing | Radix Router | ✓ | ✓ | implemented |
| Core Routing | Reverse Proxy Handler | ✓ | ✓ | implemented |
| Core Routing | Request Pipeline | ✓ | ✓ | implemented |
| Core Routing | Request Context Pool | ✓ | ✓ | implemented |
| Core Routing | WebSocket Tunneling | ✓ | ✓ | implemented |
| Core Routing | OpenAPI Generator | ✓ | ✓ | implemented |
| Core Routing | Client Disconnect Propagation | ✓ | ✓ | implemented |
| Core Routing | Request Coalescing | ✓ | ✓ | implemented |
| Core Routing | Streaming Response Path | ✓ | ✓ | implemented |
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
| Observability | Access Log Sampling | ✓ | ✓ | implemented |
| Observability | CPU & Memory Profiler | ✓ | ✓ | implemented |
| Operations | Config Loader & Validator | ✓ | ✓ | implemented |
| Operations | Plugin Execution Chain | ✓ | ✓ | implemented |
| Operations | Auto Tuner | ✓ | ✓ | implemented |
| Identity & Security | JWT Auth Plugin | ✓ | ✓ | implemented |
| Identity & Security | API Key Engine | ✓ | ✓ | implemented |
| Identity & Security | Upstream Credential Injection | ✓ | ✓ | implemented |
| Identity & Security | RFC 7807 Problem Details | ✓ | — | implemented |

## Benchmark

Diukur di target homelab (4-core i5-6500T, Node 22):

| Scenario | Result | Target |
|---|---|---|
| Hot target path (load-test, 100 conn) | **P99 5ms · 38,405 RPS** | P99 < 10ms · RPS > 10k ✓ |
| acquire+release pool overhead | 1.5 µs/op | — |
| Circuit breaker CLOSED fast-path | ~1.1 µs/req saved | — |
| Full proxy path @ 100 conn | ~3.2k RPS · P99 ~40ms | hardware-bound ceiling* |

\* Plafon full-proxy terikat round-trip loopback di mesin 4-core bersama (hop url-forward mentah saja terukur 223 µs/op), bukan overhead kode — kode gateway di atas hop mentah itu ~28%. Didokumentasikan jujur; tidak dikejar lebih lanjut.
