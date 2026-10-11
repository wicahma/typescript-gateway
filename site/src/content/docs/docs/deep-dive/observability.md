---
title: "Observability"
description: "Lock-free metrics, structured logging, live dashboard, and in-process profiling."
---

Every feature in this group is **implemented and verified**, each with unit and integration coverage in the repo test suite.

## What It Does

The observability subsystem delivers low-overhead telemetry, structured JSON logging, lock-free metrics collection, live terminal diagnostics, and on-demand CPU/memory profiling.

### CPU & Memory Profiler

An in-process diagnostic toolkit using native Node.js V8 primitives:
- **CPU Sampling (`CPUProfiler`)**: Captures stack samples via the V8 Inspector Session or lightweight error-stack sampling, generating collapsed-stack flame graphs.
- **Heap Diagnostics (`MemoryProfiler`)**: Generates `.heapsnapshot` dumps into `heapdumps/`, tracks heap growth rates (MB/hour), and flags leak thresholds.
- **V8 Shape Analysis**: Checks hidden class stability and warns about polymorphic call-sites.

### Lock-Free Metrics & Latency Histogram

High-performance metrics collection avoiding garbage collection overhead:
- **Ring-Buffer Histogram (`LatencyHistogram`)**: Bounded sample array (10,000 samples) with O(1) writes and deferred percentile sorting at read time.
- **Atomic Histogram (`MetricsAggregator`)**: Implements lock-free counters and histogram buckets over `Int32Array` using `Atomics`, compatible with `SharedArrayBuffer` workers.
- **Prometheus Exposition**: Standard Prometheus text format exposition at `/metrics` via `Accept: text/plain` or `?format=prometheus`.

### Native Structured Logger

High-speed newline-delimited JSON logging:
- **Buffered writes**: lines accumulate in memory and flush at 64 KiB or after 1 second, replacing one `process.stdout.write` per line (2447 ns/op) with one write per batch (276 ns/op).
- **Cached timestamps**: the ISO timestamp is computed once per whole second (72 ns/op) instead of per line (837 ns/op).
- **Context Enrichment**: Injects `requestId`, timestamps, route identifiers, and latency metrics.

### Live Performance Dashboard

A terminal-based operational dashboard (`src/dashboard/index.ts`) providing real-time ASCII visualizations of RPS, p50/p95/p99 latencies, upstream health, and memory allocation rates.

### Access Log Sampling

A sampling ratio (`monitoring.sampling.rate`) logs a representative percentage of successful requests while capturing 100% of server errors (HTTP >= 500). The ratio is converted to an interval: `0.5` logs every second request, `0.1` every tenth.

## Configuration

Observability settings are managed through `monitoring` configuration blocks and programmatic defaults:

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `monitoring.metrics.enabled` | boolean | `true` | Adds per-route and per-upstream views to the `/metrics` payload. |
| `monitoring.export.prometheus.path` | string | `"/metrics"` | Path of the metrics endpoint. The default path stays registered for compatibility when a custom path is set. |
| `monitoring.sampling.rate` | number | `1.0` | Access log sampling ratio (0.0 to 1.0). `1.0` logs every request; `0.5` logs every second request; `0.1` every tenth. Responses with status `>= 500` are always logged regardless of the rate. |

The `monitoring` block is optional as a whole, but the `MonitoringConfig` type declares every sub-field as required, so supplying `monitoring` means supplying the full shape (`metrics`, `health`, `export.prometheus`, `tracing`, `sampling`, `logging`). The loader does not deep-validate or default the block — the three fields above are the only ones read by the runtime.

Log level is not part of the config file: it is read from the `LOG_LEVEL` environment variable (`trace`, `debug`, `info`, `warn`, `error`, `fatal`), defaulting to `info`. There is no `monitoring.logging.level` or `monitoring.logging.format` key — log output is always newline-delimited JSON.

### Log buffering

Log lines are buffered in memory and flushed when either threshold is reached:

- **Size**: 64 KiB of accumulated output (`FLUSH_BYTES`).
- **Time**: 1 second since the first unflushed line (`FLUSH_MS`).

A `process.on('exit')` hook flushes the remaining buffer, and `logger.flush()` forces a flush on demand. Batching replaces one `process.stdout.write` per line (measured 2447 ns/op) with a single write per batch (276 ns/op) — 8.9x cheaper on the logging path. Timestamps are cached per whole second (72 ns/op vs 837 ns/op for a fresh `toISOString()`).

If `destination` is set, the batch is appended with `appendFileSync`; a write failure falls back to `process.stdout.write`.

## Interactions

Observability instruments every stage of the request lifecycle:

1. **Context Initialization**: `RequestContext` assigns a unique `requestId` and records the initial monotonic timestamp (`process.hrtime.bigint()`).
2. **Pipeline Execution**: Errors, rate limits, and circuit breaker transitions increment corresponding counter metrics.
3. **Response Flush**: The final response status, duration, and byte sizes are passed to the access logger and recorded in the latency histogram.
4. **Scraping Endpoint**: The `/metrics` endpoint reads the aggregated atomic histogram without halting or locking the active request pipeline.

## Tradeoffs and Failure Modes

- **Synchronous Heap Dumps**: Invoking `v8.writeHeapSnapshot()` blocks the Node.js event loop synchronously for several seconds on large heaps. Heap snapshots should only be triggered on-demand during dedicated diagnostic sessions, not routine production operation.
- **Sampling vs Observability Detail**: Logging every single request at 100k RPS generates massive log volumes and I/O pressure. Access log sampling reduces log I/O overhead while guaranteeing visibility into all failure responses.
- **Prometheus Scrape Costs**: Generating Prometheus text metrics requires reading and sorting histogram percentiles. Scraping intervals should be kept at reasonable cadences (e.g. 10-15s) to avoid unnecessary CPU spikes.
- **Fixed Memory Ring Buffers**: Latency histograms operate over fixed-size ring buffers to guarantee zero memory growth over time, meaning very old request data is continually overwritten by newer samples.
