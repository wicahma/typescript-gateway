---
title: "Resilience"
description: "Circuit breaker, retries, health checks, fallbacks, and timeout budgets."
---

Every feature in this group is **implemented and verified**, each with unit and integration coverage in the repo test suite.

## What It Does

The resilience subsystem safeguards the gateway and its upstreams against cascading failures, network instability, and latency degradation.

### Circuit Breaker

The circuit breaker protects the gateway and its upstreams from cascading failure: when an upstream keeps failing, the breaker opens (*OPEN*) so subsequent requests are rejected instantly at the gateway without touching the dying upstream. After a cooldown, the breaker moves to *HALF_OPEN* to re-probe the connection with limited traffic, then returns to *CLOSED* once recovered.

- **State CLOSED (fast-path)**: Requests execute immediately; metrics record into a sliding-window counter.
- **State OPEN**: Triggered when the failure rate exceeds `failureThreshold`. Cooldown timer `resetTimeout` begins. Requests fail immediately with `CircuitOpenError` and route to fallbacks.
- **State HALF_OPEN**: Cooldown expires and a canary probe is permitted. A successful probe closes the breaker; a failure re-opens it.

### Retry Manager

The Retry Manager executes upstream requests with automatic retry: transient failures (502, 503, 504, 408, 429, `ECONNREFUSED`, timeouts) are retried with exponential backoff and full jitter.

- **Idempotency Filter**: Only idempotent HTTP methods (`GET`, `PUT`, `DELETE`, `HEAD`, `OPTIONS`) are retried. `POST` requests execute once to prevent duplicate side effects.
- **Jitter and Budget**: Jitter prevents thundering herd spikes. Retries halt if the accumulated request duration exceeds the timeout budget or if the circuit breaker trips to OPEN.

### Health Checker

The Health Checker maintains upstream health state (`healthy: boolean`) to guide load balancing and circuit breaking.

- **Active Probing**: Periodically issues `GET /health` to backend nodes and checks status codes.
- **Passive Probing**: Evaluates production request outcomes and latency during live proxy forwarding without generating extra network traffic.
- **Hysteresis Guard**: Requires consecutive failures (`unhealthyThreshold`) before marking a node UNHEALTHY, and consecutive successes (`healthyThreshold`) before returning it to HEALTHY status.

### Fallback Handler

The Fallback Handler serves graceful degradation responses when upstream requests fail due to timeouts, errors, or tripped circuit breakers:

1. **Static Fallback**: Explicit custom responses configured per route or upstream.
2. **Stale Serving**: Re-serves cached responses within `ttl + maxStaleAge` accompanied by `Warning: 110 - "Response is Stale"`.
3. **Default Template**: Emits RFC-compliant JSON problem responses (502, 503, 504) with `x-fallback-response: true`.

### Timeout Manager

The Timeout Manager enforces five operation budgets to ensure requests never hang indefinitely:
- `connection` (5 s): Upstream socket connection time.
- `request` (30 s): Total end-to-end request budget.
- `upstream` (20 s): Upstream response latency budget.
- `plugin` (1 s): Single plugin execution limit.
- `idle` (60 s): Pooled idle connection lifetime.

## Configuration

Resilience features are configured per upstream or globally in `gateway.config.json`:

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `upstreams[].healthCheck.enabled` | boolean | `true` | Enables periodic health monitoring for this upstream. |
| `upstreams[].healthCheck.interval` | number | `10000` | Milliseconds between active health probes. |
| `upstreams[].healthCheck.timeout` | number | `5000` | Milliseconds before a probe request is marked failed. |
| `upstreams[].healthCheck.path` | string | `"/health"` | HTTP endpoint queried for active health checks. |
| `upstreams[].healthCheck.expectedStatus` | number | `200` | Expected HTTP status code for healthy nodes. |
| `circuitBreaker.failureThreshold` | number | `50` | Failure percentage required to trip the breaker OPEN. |
| `circuitBreaker.resetTimeout` | number | `60000` | Cooldown period (ms) in OPEN state before canary probing. |
| `circuitBreaker.halfOpenSuccessThreshold` | number | `3` | Canary successes required to return to CLOSED state. |
| `retry.maxAttempts` | number | `3` | Maximum execution attempts for retryable failures. |
| `retry.initialDelay` | number | `200` | Base backoff delay in milliseconds. |
| `retry.maxDelay` | number | `5000` | Maximum cap for exponential backoff delay. |
| `retry.jitter` | boolean | `true` | Applies randomized jitter to backoff intervals. |
| `fallback.enableStaleFallback` | boolean | `true` | Permits serving expired cached entries during outages. |
| `fallback.maxStaleAge` | number | `300000` | Maximum allowable stale age (ms) for cached fallback data. |

## Interactions

Resilience components coordinate closely within the proxy forwarding phase:

1. **Routing and Filtering**: The router selects the route. The Health Checker provides the list of active healthy upstream nodes to the load balancer.
2. **Circuit Check**: Before leasing a connection from `HttpClientPool`, the Circuit Breaker checks target health. An `OPEN` breaker immediately diverts the request to the Fallback Handler.
3. **Execution & Retry Loop**: The Retry Manager wraps upstream forwarding. If the call fails with a retryable status or network timeout, exponential backoff pauses before the next attempt.
4. **Fallback Delivery**: If all retry attempts fail or timeouts trigger, the Fallback Handler intercepts the error and returns static templates, stale cache, or structured error JSON.
5. **Passive Feedback**: Request success or failure updates passive health check counters and circuit breaker sliding windows.

## Tradeoffs and Failure Modes

- **Cascading Failure Prevention vs Latency**: Circuit breaking sacrifices immediate availability of failing nodes to protect the gateway process and healthy upstreams from socket exhaustion.
- **Retry Amplification**: Retrying against an overloaded upstream can worsen degradation. The Retry Manager mitigates this by restricting retries to idempotent methods, applying jitter, and checking circuit state before each attempt.
- **Stale Serving Consistency**: Fallback stale serving improves uptime during backend downtime at the cost of eventual consistency. Clients receive clear `Warning: 110` headers indicating stale responses.
- **Flapping Mitigation**: Hysteresis thresholds in the Health Checker prevent upstream nodes from rapidly alternating between healthy and unhealthy states due to transient network hiccups.
