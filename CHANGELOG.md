# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.1]

### Added
- Regex-group path params: `/orders/:orderId(\d+)`.
- OpenAPI 3.1 document as a routing source (`openapi.spec`).

## [1.2.0]

### Added
- Traffic shadowing (mirror a sampled fraction of traffic to a shadow upstream).
- Inbound HMAC verification for webhooks.
- Per-consumer daily quota on top of the per-minute rate limit.
- SSRF guard (blocks private/loopback/link-local targets).
- Security headers + server-banner stripping.
- Sticky sessions (pin a caller to one upstream).
- Admin control plane: `GET /__admin/state`, `POST /__admin/cache/purge`.
- OpenAPI-style `{param}` route syntax.

## [1.1.0]

### Added
- CORS policy (preflight + `Access-Control-*` headers).
- W3C trace-context propagation (`traceparent`).
- Idempotency-key policy for `POST`/`PATCH` (replay, `400` on key reuse with a
  different body, `409` while in flight).
- Outbound secret masking (JWT, PEM private keys, sensitive JSON fields).
- Adaptive load shedding with a concurrency limiter that tracks p95 latency.
- `onComplete` pipeline hook for resource release on every request path.

### Changed
- The inbound policy pipeline now runs **before** route matching, so
  pre-routing concerns (CORS, auth, rate limiting, load shedding) can
  short-circuit uniformly.

## [1.0.8]

### Changed
- Publish to npm via OIDC trusted publishing (Node 24, npm ≥ 11.5.1); releases
  carry SLSA provenance.

### Fixed
- De-flaked the compression performance test (warm-up + best-of-N) so a cold,
  loaded CI runner no longer fails on a single timing sample.

## [1.0.0]

### Added
- First public release: radix router, reverse proxy pipeline, connection pool,
  circuit breaker, retries, health checks, rate limiting, response cache with
  stale-while-revalidate, load balancing, body parsing and transformation,
  compression, JWT auth, API keys, upstream credential injection (HMAC),
  RFC 7807 problem details, metrics, structured logging, and a plugin system —
  all on the Node.js standard library with zero runtime dependencies.
