---
title: "Feature Matrix"
description: "All 52 features across 7 groups, with implementation status."
---

All 52 features across 7 groups, each backed by unit and integration test coverage. 1075/1075 tests green.

## What It Does

The gateway implements 52 distinct capabilities divided across seven core functional subsystems. Every feature listed below is verified in automated unit and integration suites.

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
| Resilience | Traffic Shadowing | implemented |
| Identity & Security | Inbound HMAC Verification | implemented |
| Traffic Control | Daily Quota (per consumer) | implemented |
| Identity & Security | SSRF Guard | implemented |
| Identity & Security | Security Headers | implemented |
| Operations | Admin Control Plane | implemented |
| Traffic Control | Sticky Sessions | implemented |
| Core Routing | OpenAPI {param} Syntax | implemented |
| Core Routing | Regex-Group Path Params | implemented |
| Core Routing | OpenAPI Route Source | implemented |
| Traffic Control | CORS Policy | implemented |
| Observability | W3C Trace Context | implemented |
| Identity & Security | Outbound Secret Masking | implemented |
| Traffic Control | Idempotency Keys | implemented |
| Resilience | Adaptive Load Shedding | implemented |
| Resilience | Concurrency Limiter | implemented |
| Operations | Request Record Store | implemented |
| Operations | Request Replay | implemented |
| Observability | Audit Event Stream | implemented |

## Configuration

Features are collectively declared, enabled, and tuned through `config/gateway.config.json`:

| Feature Area | Configuration Path | Core Controls |
|---|---|---|
| Routing & Upstreams | `routes`, `upstreams` | Methods, path patterns, target origin URLs, timeout budgets. |
| Resilience | `upstreams[].healthCheck`, `plugins[circuit-breaker]` | Health intervals, error thresholds, circuit trip cooldowns. |
| Traffic Management | `plugins[rate-limit]`, `plugins[cache]` | Window size, max tokens, TTL cache limits, key extractors. |
| Security | `apiKeys`, `plugins[auth-jwt]` | JWKS keys, API key header names, issuer/audience validation. |
| Performance | `performance` | Worker counts, memory pool sizing, buffer capacities. |

## Interactions

Features cooperate in a strict layered pipeline:
1. **Network & Ingress**: The native HTTP server receives the socket connection and allocates a pooled `RequestContext`.
2. **Pre-Routing Security**: API Key verification and JWT token checks validate identity and enforce rate limiting quotas.
3. **Routing Match**: The Radix Router selects the upstream target based on HTTP method and path patterns.
4. **Resilience & Proxying**: Circuit breakers, retry managers, and reverse proxy handlers dispatch the request to the upstream origin.
5. **Post-Processing & Telemetry**: Transformers modify headers or bodies, access logs are emitted, and metrics counters are updated atomically.

## Tradeoffs and Failure Modes

### Benchmarks

Measured on the reference target (4-core x86_64, Node 22):

| Scenario | Result | Target |
|---|---|---|
| Hot target path (load-test, 100 conn) | **P99 5ms · 38,405 RPS** | P99 < 10ms · RPS > 10k ✓ |
| acquire+release pool overhead | 1.5 µs/op | — |
| Circuit breaker CLOSED fast-path | ~1.1 µs/req saved | — |
| Full proxy path @ 100 conn | ~3.2k RPS · P99 ~40ms | hardware-bound ceiling* |

\* The full-proxy ceiling is loopback round-trip bound on a shared 4-core box (raw url-forward hop alone measures 223 µs/op), not code overhead — gateway code above the raw hop is ~28%. Documented honestly; not chased further.

### Failure Behaviors

- **Subsystem Isolation**: Plugin or policy failures bubble up as structured RFC 7807 responses rather than crashing the Node.js process.
- **Resource Exhaustion**: When concurrency limits or load-shedding thresholds are breached, the gateway sheds excess load with HTTP 503 or 429 rather than exhausting event loop memory.
