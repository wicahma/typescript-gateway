---
title: "Testing & Benchmarks"
description: "Test suite specifications, execution commands, verification proofs, and known performance ceilings."
---

The gateway test harness verifies correctness, regression resistance, and latency bounds across the entire codebase using Vitest and Node standard libraries.

## Test Suites

The test matrix consists of unit, integration, and performance lanes across 1,075 tests:

| Suite | Path | Scope | Verification Target |
| --- | --- | --- | --- |
| Unit | `tests/unit` | Isolated component logic | Algorithmic correctness, edge cases, error branches |
| Integration | `tests/integration` | End-to-end proxy pipeline | HTTP lifecycle, socket pooling, plugin ordering, upstreams |
| Performance | `tests/performance` | Microbenchmarks with timing guards | Zero-allocation bounds, pool recycling overhead |

## Execution Commands

Execute the test suites via standard npm lifecycle scripts:

```bash
# Run all test suites
npm test

# Run isolated unit tests
npm run test:unit

# Run full proxy integration tests
npm run test:integration

# Run performance regression guards
npm run test:perf
```

## What a Green Run Proves

A passing test run establishes three formal guarantees:

1. **Protocol Compliance**: RFC-compliant HTTP parsing, status code handling, header normalization, and streaming body behavior.
2. **Resilience Determinism**: Circuit breakers transition across CLOSED, OPEN, and HALF-OPEN states reliably; retry jitter and fallback mechanisms behave predictably under simulated failures.
3. **Zero-Allocation Invariants**: Request contexts and object pools successfully recycle without memory leakage or unexpected V8 heap expansion.

## Performance Guards and Ceilings

The performance lane executes timing assertions designed to catch order-of-magnitude regressions:

- **Pool Fast-Path Guard**: The request context pool acquire/release cycle is guarded at `50 µs/op` (accommodating CI scheduling variance on shared virtual cores).
- **Loopback Round-Trip Ceiling**: Full-proxy throughput ceiling (~3.2k RPS, P99 ~40 ms at 100 concurrent connections on a 4-core host) is bound by kernel loopback round-trip latency (`node:http` upstream hop measures ~223 µs/op). Gateway overhead represents approximately 28% of the total path.

## Reference Benchmarks

Reproducible standalone benchmark scripts:

```bash
npm run benchmark            # Full hot path under concurrent load
npm run benchmark:router     # Radix tree lookup throughput
npm run benchmark:context    # Object pool acquire and release rates
npm run benchmark:plugins    # Plugin execution chain traversal
```

Measured baselines on reference hardware (4-core x86_64, Node 22):

| Scenario | Measurement | Target Bound |
| --- | --- | --- |
| Hot target path (100 conn) | P99 5 ms · ~38.4k RPS | P99 < 10 ms |
| Pool acquire + release | ~1.5 µs/op | < 50 µs/op |
| Circuit breaker CLOSED path | ~1.1 µs/req saved | Zero locking overhead |
| Full proxy path (100 conn) | ~3.2k RPS · P99 ~40 ms | Hardware-bound ceiling |
