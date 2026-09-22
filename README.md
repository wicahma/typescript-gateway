<div align="center">

# TypeScript Gateway

**A simple gateway. It's all you need.**

Production-grade HTTP API gateway in pure TypeScript on native `node:http` —
zero runtime dependencies, one process, no frameworks.

[![CI](https://ci.diama.dev/api/badges/10/status.svg)](https://ci.diama.dev/repos/10)
[![Zero runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-2952ff)](package.json)
[![Tests](https://img.shields.io/badge/tests-918%20passing-2952ff)](tests)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-2952ff)](tsconfig.json)
[![Node](https://img.shields.io/badge/node-%3E%3D20-2952ff)](package.json)
[![License](https://img.shields.io/badge/license-MIT-2952ff)](LICENSE)

[Documentation](https://tsgate.diama.dev) ·
[Getting Started](https://tsgate.diama.dev/docs/getting-started) ·
[Feature Matrix](https://tsgate.diama.dev/docs/features) ·
[Report a bug](https://github.com/wicahma/typescript-gateway/issues)

</div>

---

## Why

Most gateways pull in a framework, a router, an HTTP client, a metrics
library, and a dozen transitive packages before they proxy a single byte.
This one doesn't. Every hot-path component — radix router, connection pool,
circuit breaker, cache, compression — is implemented on the Node.js standard
library, which means a trivial audit surface, no supply-chain churn, and a
`node_modules` you can read in one sitting.

```
npm install   →   0 production packages
node dist/index.js   →   that's the whole runtime
```

## Quick start

```bash
git clone https://github.com/wicahma/typescript-gateway.git
cd typescript-gateway
npm install

PORT=8088 npm start
curl http://localhost:8088/health
```

Minimal config (`config/gateway.config.json`):

```json
{
  "server": { "port": 8088 },
  "routes": [{ "method": "GET", "path": "/api/*" }],
  "upstreams": [{ "id": "backend", "host": "localhost", "port": 3000 }]
}
```

Every `GET /api/**` now proxies to `localhost:3000` with connection pooling,
circuit breaking, and caching already on the hot path.

## Features

**Core routing** — radix-tree router (O(log n) dynamic, O(1) static) ·
request-context pooling · streaming proxy path for large bodies ·
single-flight request coalescing (a cache-miss stampede costs one upstream
call, not N) · client-disconnect propagation (abort upstream work when the
caller goes away) · WebSocket tunneling (opt-in) · zero-dep OpenAPI 3
generator from the live route table

**Resilience** — circuit breaker (CLOSED/OPEN/HALF_OPEN) · retries with
exponential backoff + jitter · active/passive/hybrid health checks ·
fallback handler with stale serving · hierarchical timeouts · per-route
timeout override

**Traffic control** — rate limiting (token bucket, sliding window, fixed
window) · response cache with SWR, Vary-aware keys, and conditional
revalidation (ETag/`Last-Modified` persisted; upstream 304 merges without a
body transfer) · load balancing (round-robin, least-connections, weighted,
IP hash, random)

**Payload** — stream-based body parsing (JSON, URL-encoded, multipart, text) ·
request/response transformation · compression (gzip, brotli, deflate)

**Identity & security** — JWT auth · API keys · upstream credential injection
(HMAC signing) · RFC 7807 problem details

**Observability** — lock-free metrics with histograms · structured logging ·
sampled access logging (errors ≥ 500 always logged) · live performance
dashboard · CPU/memory profilers

**Operations** — validated config with env interpolation and hot reload ·
plugin chain with isolated async hooks · auto-tuner

Full details: [Feature Matrix](https://tsgate.diama.dev/docs/features) —
30 features, each with an FSD + ERD spec pair.

## Performance

Measured on a 4-core i5-6500T (homelab hardware — your mileage will be better):

| Metric | Value |
|---|---|
| Raw forward hop | ~223 µs/op |
| Hot path (benchmark target path) | P99 5 ms, ~38k RPS |
| Full proxy pipeline | ~3.2k RPS @ 100 parallel connections |
| Production dependencies | **0** |

```bash
npm run benchmark           # load test with P99/RPS verdicts
npm run benchmark:router    # radix router micro-bench
```

## Plugin system

```ts
import { Plugin } from 'typescript-gateway';

export const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',

  async preRoute(ctx) {
    // before routing
  },

  async postResponse(ctx) {
    // after the response is sent
  },
};
```

Lifecycle hooks: `init` · `preRoute` · `preHandler` · `postHandler` ·
`postResponse` · `onError` · `destroy`. Hooks listed in `plugin.asyncHooks`
run off the request path (`setImmediate`-scheduled) — latency-sensitive
plugins never block responses.

## Scripts

```bash
npm run dev          # tsx, hot reload
npm test             # 918 tests (vitest)
npm run typecheck    # strict tsc, zero errors
npm run benchmark    # load-test with pass/fail verdicts
npm run site:dev     # docs site (Astro) locally
```

## Project layout

```
src/
├── core/        router, server, proxy handler, pools, cache, breaker
├── pipeline/    policy chain (rate limit, cache, auth, …)
├── plugins/     plugin loader + execution chain
├── config/      schema, loader, validator, hot reload
└── types/       shared contracts
site/            docs site → tsgate.diama.dev
benchmarks/      load + micro benchmarks
tests/           unit, integration, performance
```

## Requirements

- Node.js **≥ 20**
- That's it.

## Contributing

Fork → branch → tests → PR. Performance-critical changes must ship with a
benchmark. New features need unit tests; the suite is the contract.

## License

[MIT](LICENSE)
