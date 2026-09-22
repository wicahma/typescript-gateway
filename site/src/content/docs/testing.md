---
title: "Testing & Benchmarks"
description: "Running the test suites, reproducible performance benchmarks, and known ceilings."
order: 13
section: "Guide"
---

# Testing & Benchmarks

## Test Suites

Vitest, 918 tests across 59 files at last full run. Three lanes:

```bash
npm test                      # all suites
npm run test:unit             # tests/unit
npm run test:integration      # tests/integration (proxy + pipeline end-to-end)
npm run test:perf             # tests/performance (benchmarks with guards)
```

The performance suite uses timing guards with wide headroom. The pool fast-path guard is set to **50 µs/op** (was 5 µs; CI variance measured 5.26 µs once on the homelab 4-core box). These guards are informational — they fail on order-of-magnitude regressions, not on single-digit jitter.

## Benchmarks

```bash
npm run benchmark            # load-test.js — hot path under real concurrency
npm run benchmark:router     # router match throughput
npm run benchmark:context    # context pool acquire/release
npm run benchmark:plugins    # plugin execution chain
```

Current numbers on the homelab target (4-core i5-6500T, Node 22):

| Scenario | Result | Note |
|---|---|---|
| Hot target path (100 conn) | **P99 5 ms · ~38.4k RPS** | target P99 < 10 ms ✓ |
| Pool acquire + release | ~1.5 µs/op | fast-path |
| Circuit breaker CLOSED fast-path | ~1.1 µs/req saved | no lock on steady state |
| Full proxy path @ 100 conn | ~3.2k RPS · P99 ~40 ms | hardware-bound ceiling* |

\* The full-proxy ceiling is loopback round-trip bound on a shared 4-core box (a raw `url`-forward hop alone measures ~223 µs/op; gateway code above that raw hop is ~28% of the path). This is a machine limit, not a code limit — documented and not re-chased.

## Running a Local Upstream for Integration Tests

Integration tests spin up real upstreams on ephemeral ports; no external service needed. To simulate yourself:

```bash
# minimal upstream (any static server works)
python3 -m http.server 8080

# point the gateway at it
PORT=8088 npm start

curl http://localhost:8088/health   # should report the upstream as healthy
```
