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

High-speed JSON logging writing directly to `process.stdout.write`:
- **Zero Allocations**: Avoids string formatting overhead in the request hot path.
- **Context Enrichment**: Injects `requestId`, timestamps, route identifiers, and latency metrics.

### Live Performance Dashboard

A terminal-based operational dashboard (`src/dashboard/index.ts`) providing real-time ASCII visualizations of RPS, p50/p95/p99 latencies, upstream health, and memory allocation rates.

### Access Log Sampling

Configurable head/tail sampling strategies that log a representative percentage of successful requests while capturing 100% of error responses (HTTP >= 400).

## Configuration

Observability settings are managed through `monitoring` configuration blocks and programmatic defaults:

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `monitoring.metrics.enabled` | boolean | `true` | Enables latency and throughput metrics collection. |
| `monitoring.metrics.path` | string | `"/metrics"` | Endpoint path exposing Prometheus and JSON metrics. |
| `monitoring.logging.level` | string | `"info"` | Minimum log level (`debug`, `info`, `warn`, `error`). |
| `monitoring.logging.format` | string | `"json"` | Log output format (`json`, `text`). |
| `monitoring.sampling.rate` | number | `1.0` | Inbound request access log sampling ratio (0.0 to 1.0). |
| `monitoring.sampling.alwaysLogErrors` | boolean | `true` | Forces access logs for all requests with status >= 400. |
| `profiler.samplingInterval` | number | `1000` | CPU profiling sampling interval in microseconds. |
| `profiler.maxSamples` | number | `10000` | Maximum stack samples recorded before auto-stop. |
| `memory.retentionDays` | number | `7` | Days to retain heap snapshot files on disk. |

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
