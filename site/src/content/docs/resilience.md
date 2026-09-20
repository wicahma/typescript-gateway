---
title: "Resilience (F2)"
description: "Circuit breaker, retries, health checks, fallbacks, and timeout budgets."
order: 5
section: "Features"
---

All 5 features in this group are **implemented and verified** — each has a full FSD + ERD spec pair and unit/integration coverage in the repo test suite.

## Circuit Breaker

The circuit breaker protects the gateway and its upstreams from *cascading failure*: when an upstream
keeps failing, the breaker opens (*OPEN*) so subsequent requests are rejected instantly at the
gateway without touching the dying upstream. After a cooldown, the breaker moves to *HALF_OPEN*
to re-probe the connection with limited traffic, then returns to *CLOSED* once recovered.

The implementation follows Martin Fowler's three-state machine, per-upstream instance,
purely in-memory, no external dependencies (`node:process.hrtime.bigint()` for time
measurement, `setTimeout` rather than a library).

**Goals:**
- Stop failure cascades before they exhaust the gateway's socket pool.
- Give upstreams time to recover (default 60-second cooldown).
- Provide observability: success rate, failure rate, state-change count, time spent per state.

### How it works

1. `execute(fn)` is called by the proxy handler per upstream request.
2. State `CLOSED` (fast-path): the request executes immediately; success/failure is still
   recorded into the sliding-window counter so thresholds stay accurate without hrtime/logging cost.
3. Failure rate window exceeds `failureThreshold` → state `OPEN` (breaker open,
   the `resetTimeout` cooldown timer starts).
4. Requests during `OPEN` fail fast (`CircuitOpenError`) without touching the
   upstream — the proxy handler routes them to the fallback handler.
5. Cooldown expires → `HALF_OPEN`: one canary request is allowed. Success → back to
   `CLOSED` (window reset); failure → back to `OPEN` with a new cooldown.


## Retry Manager

The Retry-Manager executes upstream requests with automatic retry: transient failures
(502/503/504/408/429, `ECONNREFUSED`, timeouts) are retried with
*exponential backoff + jitter* until the attempt limit or the time budget is exhausted. Its goal
is to raise the success rate without overloading a struggling upstream (*thundering herd*
prevented by jitter) and without unbounded latency (*retry budget*).

### How it works

1. `RetryManager.execute(fn, context, config?)` is called by the proxy pipeline for requests
   eligible for retry.
2. **Method filter** — only idempotent methods are retried (default `GET, PUT, DELETE,
   HEAD, OPTIONS`). `POST` executes exactly once without retry (retries could duplicate effects).
3. **Attempt loop** (`1..maxAttempts`, default 3):
   - Check the *retry budget*: `elapsedTime >= timeout` (default 30000 ms) → stop.
   - Check the circuit breaker (if provided in `context.circuitBreaker`): state `OPEN` → stop,
     no attempts wasted on an upstream already declared down.
   - Attempt > 1: compute `delay = initialDelay * backoffMultiplier^(attempt-1)`, cap at
     `maxDelay` (5000 ms); when `jitter: true`, delay = `random() * delay` (*full jitter*);
     the delay is then clamped so it never exceeds the remaining budget, then `sleep`.
4. **Retryable decision** — `shouldRetry()`: errors flagged retryable, `GatewayError`
   with a status in `retryableStatuses`, or messages containing `timeout / econnrefused /
   econnreset / ehostunreach / enetunreach / unavailable`.
5. **Result** — `RetryResult<T>`: final `value` or `error`, plus `attempts`, `totalTime`,
   `retried` (boolean) — no exception is thrown to the caller.
6. Statistics: `getStats()` → `activeRetries, totalRetries, successfulRetries, failedRetries,
   successRate`; `resetStats()` resets the counters.


## Health Checker

The Health-Checker maintains per-upstream health status (`healthy: boolean`) that feeds
routing, load balancer, and circuit breaker decisions. Three probe modes:

- **Active** — the gateway periodically (default every 10 s) sends `GET {host}:{port}/health`
  and evaluates the status code; status stays current even without traffic.
- **Passive** — health is inferred from real traffic: `recordPassiveCheck()` is called
  by the proxy handler after every upstream request (success/failure + response time). No
  extra probing — a good fit for upstreams that are expensive to probe.
- **Hybrid** — active is tried first; on failure, falls back to passive (avoids
  false negatives when the health endpoint is busy).

Goal: a dead upstream is pulled from rotation within a few probe intervals,
not only when a client request fails.

### How it works

1. `start(upstreams)` is run by the ProxyHandler at boot; every upstream with
   `healthCheck.enabled` is registered + one `setInterval` per upstream (default
   10 s interval), plus one immediate initial check.
2. Every probe produces `HealthCheckResult { upstreamId, status, responseTime, timestamp,
   error?, checkType }`; active check: `statusCode === expectedStatus` (default 200) →
   HEALTHY; timeout (default 5 s) or network error → UNHEALTHY. The response body
   is *drained* so the socket doesn't hang.
3. `performTCPCheck()` is available as a TCP-level probe (socket connection only, no HTTP).
4. `processResult()` updates `HealthCheckStats`: total/success/failure counters,
   moving-average response time, `consecutiveFailures` / `consecutiveSuccesses`.
5. **Threshold hysteresis**: UNHEALTHY after `unhealthyThreshold` (3) consecutive
   failures; HEALTHY again after `healthyThreshold` (2) consecutive successes —
   prevents flapping from a single momentary failure.
6. **Grace period** (default 5 s): newly added upstreams are considered HEALTHY during
   the grace period, giving them warm-up time.
7. State changes are written to `upstream.healthy` and logged as
   `Upstream <id> health status changed to <STATUS>`.
8. `getHealthReport()` builds a gateway-level report: `healthy | degraded | unhealthy`
   (degraded = some upstreams sick), plus per-upstream `lastCheck, responseTime,
   consecutiveFailures, errorRate`.
9. `stop()` clears all intervals; `addUpstream()`/`removeUpstream()` for dynamic
   updates without restart.


## Fallback Handler

The Fallback-Handler serves a useful response to the client when the upstream cannot
serve (breaker OPEN, upstream UNHEALTHY, all retries exhausted). Instead of a raw connection
error, the client receives a structured JSON response — or better yet, a cached response
that is still serviceable (*stale serving*).

Three fallback tiers, tried in order:

1. **Static fallback** — a response registered explicitly per route or per upstream
   (`setStaticFallback(key, response)`), e.g. a maintenance page or default data.
2. **Stale cached response** — a previously successful response cached via
   `cacheResponse()` is re-served with `Warning: 110 - "Response is Stale"` +
   `x-served-from-cache: true`, as long as its age is ≤ `ttl + maxStaleAge` (default 5 minutes stale).
3. **Default template** — a JSON error matching the status code (503 `SERVICE_UNAVAILABLE`,
   502 `BAD_GATEWAY`, 504 `GATEWAY_TIMEOUT`) with the `x-fallback-response: true` header.

Goal: graceful degradation — the client always receives a parseable response,
never a connection reset.

### How it works

1. `getFallback(context)` is called by the proxy pipeline when an upstream request fails; the context
   contains `route`, `upstreamId`, `error`, `requestId`.
2. **Tier 1**: when `enableStaticFallback` and a static fallback is registered for
   `context.route`, then for `context.upstreamId` → return as-is.
3. **Tier 2**: when `enableStaleFallback` — look up the cache key `route:upstreamId`
   (or `route` alone); when present and `age <= ttl + maxStaleAge` → return the cached
   response + stale warning headers; `staleFallbackCount++`.
4. **Tier 3**: `getDefaultFallback(context)` derives the status code from the error:
   `GatewayError` → `error.statusCode`; message containing `timeout` → 504, `circuit`/
   `breaker`/`unavailable` → 503; otherwise defaults to 503. Body comes from the matching status template,
   or the generic `SERVICE_ERROR` template containing `requestId`.
5. Body is always a UTF-8 `Buffer` with `content-type: application/json`.
6. `cleanup()` removes cache entries past `ttl + maxStaleAge`; `destroy()`
   clears all maps; `getStats()` reports `totalFallbacks, staleFallbacks,
   staticFallbackCount, cachedResponseCount`.


## Timeout Manager

The Timeout-Manager bounds the duration of every kind of operation in the gateway so no request
or plugin can hang indefinitely. One component, five budgets:

- `connection` (5 s) — opening a connection to the upstream.
- `request` (30 s) — total end-to-end request time including retries.
- `upstream` (20 s) — waiting for the upstream response.
- `plugin` (1 s) — executing a single plugin in the chain.
- `idle` (60 s) — an idle pooled connection.

Goal: the gateway's p99 latency stays bounded (requests fail fast instead of hanging), resources
(sockets, timer handles) are freed on time, and the errors produced are always a structured
`TimeoutError` with type + HTTP status 504 — ready to map to fallbacks.

### How it works

1. **`execute(fn, type, context?, customTimeout?)`** — wraps the `fn` promise with
   `setTimeout(timeout)`. Before the timeout: the timer is cleared, the handle removed from
   `activeTimeouts`, the result returned. On timeout: `handle.triggered = true`,
   `AbortController.abort()` cancels the operation, counters increment, reject with
   `TimeoutError` (`timeoutType`, `timeout`, code `CONNECTION_TIMEOUT` / `REQUEST_TIMEOUT`
   / `UPSTREAM_TIMEOUT` / `PLUGIN_TIMEOUT`, status 504, retryable flag — plugin timeouts
   are not retryable).
2. **`createHandle(type, context?, customTimeout?)`** — for non-promise-based
   operations: returns `{ handleId, signal, cancel() }`; the caller attaches
   `signal` to the operation (e.g. `http.request({ signal })`) and receives the abort on timeout.
3. **`cancel(handleId)` / `cancelAll()`** — clears timers that haven't triggered (manual/shutdown
   release); already-triggered timers are left alone (already accounted).
4. **Statistics** — `getStats()` → `totalTimeouts`, `activeTimeouts`, `timeoutsByType`
   (per the five types); `hasTimedOut(handleId)`, `getElapsed(handleId)` for introspection.
5. **`destroy()`** — `cancelAll()` + clear maps; called at shutdown.
6. Handle IDs are unique: `timeout-<epoch>-<random>`; every handle is stored in
   `Map<handleId, TimeoutHandle>` while active.
