---
title: "Resilience & Reliability"
description: "Circuit breaker, health checks, retries, and load balancing algorithms."
order: 4
section: "Architecture"
---

# Resilience & Reliability

The gateway protects upstream backends through built-in traffic shaping, fault isolation, and connection recycling.

## 1. Circuit Breaker

Each upstream target is guarded by a circuit breaker state machine:

- **CLOSED**: Traffic flows normally. Error rates and timeout counters are monitored.
- **OPEN**: Upstream considered dead. Requests fail fast with HTTP 503 or return a cached fallback instantly without touching the backend network.
- **HALF-OPEN**: After a cooling interval, a canary probe is dispatched. If successful, the circuit closes; if it fails, it trips back to OPEN.

## 2. Load Balancing Strategies

Configure algorithms according to backend topology:

1. **Round Robin**: Sequential distribution across active instances.
2. **Least Connections**: Dispatches to the node with lowest active in-flight requests.
3. **Weighted**: Proportional routing based on node capacity ratings.
4. **IP Hash**: Deterministic client affinity based on caller IP.
5. **Random**: Low-overhead randomized distribution.

## 3. Intelligent Retries

- **Method-Aware**: Automatically retries idempotent verbs (`GET`, `HEAD`, `OPTIONS`, `PUT`) on connection resets (`ECONNRESET`, `ETIMEDOUT`).
- **Exponential Backoff**: Jittered delays avoid thundering herd storms on recovering services.

## 4. Rate Limiting Algorithms

Native token bucket and sliding window algorithms to throttle excessive client requests before they hit backend resources:
- Custom limiters by IP, client API token, or route path.
- Returns standard headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`.
