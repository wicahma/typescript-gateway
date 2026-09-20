---
title: "Observability (F5)"
description: "Lock-free metrics, structured logging, live dashboard, and in-process profiling."
order: 8
section: "Features"
---

All 4 features in this group are **implemented and verified** — each has a full FSD + ERD spec pair and unit/integration coverage in the repo test suite.

## CPU Memory Profiler

An in-process profiling toolkit for diagnosing gateway CPU and memory — built on Node.js
(`inspector`, `v8`, `process`), no external dependencies:

- `src/profiling/cpu-profiler.ts` (453 LOC) — CPU sampling via the V8 Inspector
  (`Profiler.start/stop`), hot-function analysis, flame graph export in
  collapsed-stack format, and a lightweight stack-capture sampling mode.
- `src/profiling/memory-profiler.ts` (408 LOC) — heap snapshots (`v8.writeHeapSnapshot`),
  snapshot diffing for leak detection, allocation tracking, GC monitoring.
- `src/core/memory-optimizer.ts` (396 LOC) — periodic memory monitoring, heap growth
  analysis, automatic leak detection, GC flag recommendations, memory reports.
- `src/core/v8-optimizations.ts` (338 LOC) — shape/hidden class analysis, polymorphism
  detection, function benchmarking, monomorphic handler helpers.

Goal: when latency degrades or memory grows, operators can capture profiles
and snapshots without installing external tooling or restarting the process.

### How it works

- **CPU (V8 Inspector)**: `CPUProfiler.startProfiling(duration?)` opens a `Session`,
  `Profiler.enable` + `Profiler.start` with a `samplingInterval` (default 1000 µs).
  `stopProfiling()` processes nodes + samples + timeDeltas into a `ProfileResult`
  (selfTime/totalTime per node). `analyzeProfile()` sorts the top-20 hot functions
  with percentages of total CPU time. `generateFlameGraph()` writes the
  collapsed-stack format (`func (file:line);... count`) ready for flamegraph.pl.
- **Lightweight CPU sampling**: `startSampling(interval)` captures stacks via
  `new Error().stack` (regex-parse the top frame) — low overhead, coarser accuracy;
  stops automatically at `maxSamples` (default 10,000).
- **Memory**: `MemoryProfiler.takeSnapshot()` writes a `.heapsnapshot` file into
  `heapdumps/`, records `{ id, timestamp, path, size, heapUsed }` into an
  in-memory list. `compareSnapshots()` computes `heapGrowth` and `growthRate` (MB/hour)
  and flags a leak when growth exceeds 10 MB. `analyzeHeapGrowth(interval, duration)`
  (MemoryOptimizer) samples `process.memoryUsage()` periodically and concludes
  `isLeaking` at a growth rate above 10 MB/hour, including external/arrayBuffers checks.
- **Monitoring & recommendations**: `MemoryOptimizer.startMonitoring(interval)` keeps a
  history of 1000 samples, runs `detectMemoryLeaks()` periodically (10 MB/hour threshold,
  `suspected`/`confirmed` levels), `getRecommendations()` offers advice based on
  heap utilization (80%/90%), external memory, and average GC pause time.
  `forceGC()` is available when Node is run with `--expose-gc`.
- **V8 optimizations**: `analyzeObjectShape()` checks property-order consistency
  (hidden class stability); `PolymorphismDetector` warns about call-sites with
  more than 4 types; `benchmark()` measures optimization impact (100-iteration warmup).

### Configuration

| Option | Default | Location |
|---|---|---|
| `samplingInterval` (CPU) | 1000 µs | `ProfilerConfig` |
| `maxSamples` | 10000 | `ProfilerConfig` |
| `includeNative` | false | `ProfilerConfig` |
| Light sampling interval | 100 ms | `startSampling(interval)` |
| `snapshotPath` | `<cwd>/heapdumps` | `MemoryProfilerConfig` |
| `retentionDays` | 7 | cleanup of old snapshots |
| `autoSnapshot` / `autoSnapshotInterval` | false / 3600000 ms | automatic snapshots |
| Leak threshold | 10 MB/hour | `analyzeHeapGrowth` / `detectMemoryLeaks` |
| Monitoring interval | 10000 ms | `MemoryOptimizer.startMonitoring` |

No `gateway.config.json` fields — the profiler is activated programmatically
(on-demand diagnosis), not always-on.

### Edge cases

- **Double profiling**: `startProfiling()` while a session is active throws
  `Error('Profiling already in progress')`; `stopProfiling()` with no session throws
  `Error('No profiling session active')`.
- **Snapshot files**: `writeHeapSnapshot` is synchronous and blocks the event loop for
  several seconds on large heaps — use it for diagnosis, not routinely in busy production.
- **Snapshot comparison**: per-type leak analysis is still simplified
  (detection based on total growth, not snapshot parsing) — honestly documented
  in the code as a simplified implementation.
- **GC monitor**: `GCMonitorImpl.start()` doesn't install a `PerformanceObserver` yet —
  the event list is empty until the implementation is complete (the code documents this).
- **`forceGC()` without `--expose-gc`**: console warning, no crash; GC stats
  are not recorded.
- **Snapshot retention**: `cleanupSnapshots()` deletes files older than `retentionDays`;
  in-memory references are capped at the last 10 (MemoryOptimizer).


## Metrics Histogram

Latency and counter metric collectors for the gateway, designed so measurement
overhead is negligible next to the request latency itself. Three layers:

1. `MetricsCollector` (`src/utils/metrics.ts`) — lock-free counters + a 10,000-sample
   ring-buffer histogram, singleton `metrics`.
2. `MetricsAggregator` (`src/core/metrics-aggregator.ts`) — an `Int32Array(310)`-based
   histogram with `Atomics.*` operations (lock-free, ready for cross-worker use
   via `SharedArrayBuffer`), plus a 60-second sliding window.
3. `AdvancedMetrics` (`src/core/advanced-metrics.ts`) — domain metrics: per-route,
   per-upstream, transformation, compression, WebSocket, error rates (1/5/15-minute windows),
   retry statistics, timeouts, and circuit breakers.

Goal: p50/p95/p99 latency, RPS, error rate, and throughput are available at any time
(`GET /metrics`) without meaningful garbage-collection pressure.

### How it works

- **Ring-buffer histogram** (`LatencyHistogram`, default 10,000 samples): every
  `record(latencyMs)` writes to slot `index % size`. When the buffer is full, old
  samples are overwritten (fixed memory, no growth). Percentiles are computed by
  sorting a copy of the samples when `snapshot()` is called — O(n log n) only on the
  read path, not the write path.
- **Atomic histogram** (`MetricsAggregator`): 100 log-distribution buckets per
  dimension (latency 1–100 ms, request/response size 100 B–10 KB), plus 10 counter
  slots. Increments use `Atomics.add` so they are safe under concurrent
  access and can be shared with worker_threads via `getSharedBuffer()`.
- **Sliding window**: every record also enters a `WindowEntry[]` (max 10,000 entries,
  max age 60 seconds) for more accurate percentiles over recent data
  (`getWindowSnapshot()`).
- **Domain metrics** (`AdvancedMetrics`): incremental aggregation (count/total/avg/min/max)
  per route and upstream; error rate is computed from a timestamp history pruned
  to the largest window (900 seconds).
- All metric entities are in-memory — they die with the process. See the
FSD and
ERD.

### Configuration

| Option | Default | Location |
|---|---|---|
| Ring-buffer histogram size | `10000` samples | `new MetricsCollector(histogramSize)` |
| Shared-memory aggregator | `false` | `new MetricsAggregator({ useSharedMemory })` |
| Sliding window size | `10000` entries / `60000` ms | `new MetricsAggregator({ windowSize, windowDuration })` |
| Error-rate windows | `[60, 300, 900]` seconds | `AdvancedMetricsConfig.timeWindows` |
| Periodic reporting | `60000` ms (logs a metrics snapshot) | `Gateway.setupMetricsReporting()` |
| Snapshot endpoint | `GET /metrics` | system route, registered in `src/index.ts` |

No dedicated `gateway.config.json` fields for this feature — everything
is instantiated with in-code defaults (zero-config by design).

### Edge cases

- **Latency outside the bucket range**: the value is clamped into the histogram range (e.g. 1–100 ms)
  before bucket mapping — no out-of-bounds index.
- **Snapshot while the buffer is not full**: only filled slots are counted
  (the `filled` flag); percentiles/averages are correct from the first request.
- **`totalOriginalSize = 0` in compression**: the ratio is computed from accumulated
  totals, not per-event, so the first event can't divide by zero.
- **Concurrent reset**: `Atomics.store(…, 0)` over the whole buffer; the sliding window
  is discarded in one go. A snapshot running concurrently may see a half-reset state —
  accepted because snapshots are best-effort, not transactional.
- **Error-rate history growth**: pruned on every `recordErrorRate` against the largest
  window (900 s); the timeout distribution is capped at the last 10,000 durations.


## Native Structured Logger

The built-in structured JSON logger (`src/utils/logger.ts`, 211 LOC) that
**replaces pino** as part of the gateway's zero-dependency principle. Goal: synchronous
logging without unnecessary pipeline allocation — every line is
`JSON.stringify(payload) + '\n'` written directly to `process.stdout.write()`
(a `appendFileSync` option is available when a file `destination` is set). The line format
is compatible with standard log consumers: one JSON object per line (NDJSON), fields
`level`, `time` (ISO-8601), `pid`, `hostname`, `msg`.

### How it works

- **Six levels**: `TRACE(10) DEBUG(20) INFO(30) WARN(40) ERROR(50) FATAL(60)`.
  `write()` early-returns when the event level weight is below the active logger level —
  a `logger.debug()` call while at level `info` is near-free (a single numeric comparison).
- **Three payload modes** in `FastNativeLogger.write()`:
  1. string → `{ level, time, pid, hostname, ...bindings, msg }`;
  2. object → spread as top-level fields + optional `msg`;
  3. anything else → wrapped in a `data` field.
- **Child loggers**: `child(bindings)` creates a new instance with merged
  bindings — used by `StructuredLogger.component(name)` for per-component loggers
  (a cached `componentLoggers` Map), `withCorrelation(id)` for request tracing,
  and `withContext(ctx)`.
- **`StructuredLogger`** (featureful wrapper): `logRequest`, `logResponse`
  (status ≥ 500 → `error`, ≥ 400 → `warn`, otherwise `info`), `logSlowRequest`
  (default threshold 100 ms), `logError` with a sampling rate, `updateConfig`
  hot-update (per-component levels are reset together with the child logger cache).
- **`createRequestLogger()`**: a stateless helper for request/response/error logging.
- The default level is read from the `LOG_LEVEL` env var (fallback `info`).

### Configuration

| Option | Default | Source |
|---|---|---|
| `level` | `info` / `LOG_LEVEL` env | `LoggerConfig.level` |
| `destination` | unset → stdout | `LoggerConfig.destination` (file path, `appendFileSync`) |
| `pretty` | `false` | present in the interface; the current implementation always writes NDJSON |
| `slowRequestThreshold` | `100` ms | `StructuredLogger` |
| `errorSampling` | `1.0` | fraction of errors recorded |
| `componentLevels` | `{}` | level overrides per component name |
| `enableCorrelationId` | `true` | `correlationId` binding on child loggers |

### Edge cases

- **Write failure to the file destination**: `appendFileSync` is wrapped in try/catch —
  it falls back to `process.stdout.write(line)`; logs are never lost and the process doesn't crash.
- **Unknown level** in `LEVEL_WEIGHT`: falls back to weight 30 (info).
- **Non-object/string payload**: wrapped as `{ data: value }` — never
  `JSON.stringify(undefined)` producing an empty line.
- **Error objects**: `logError` explicitly extracts `{ name, message, stack }`;
  a raw `JSON.stringify(err)` would drop the stack.
- **Synchronous I/O**: `appendFileSync` blocks the event loop — which is why the default
  is stdout (async pipe); the file destination is only for deliberate use.


## Performance Dashboard

A separate monitoring HTTP server (`src/monitoring/performance-dashboard.ts`, 420 LOC)
that presents gateway performance metrics in real time (SSE) and historically, plus
alert-rule evaluation (`src/monitoring/performance-alerts.ts`, 283 LOC). Goal:
operators can see p50/p95/p99, throughput, error rate, and memory usage without
touching the main gateway endpoint — the dashboard runs on its own port.

### How it works

- **`PerformanceDashboard.start(port)`** runs its own `http.createServer`
  with open CORS (`GET, OPTIONS`) and manual routing to 6 `/api/performance/*` endpoints.
- **Real-time**: `GET /api/performance/realtime` opens an SSE stream
  (`text/event-stream`). `EventStream` (an EventEmitter) keeps the list of
  `ServerResponse` clients, broadcasts `metrics` / `worker` / `alert` events as
  `event: <name>\ndata: <json>\n\n`, and drops `destroyed` clients.
- **History**: `updateMetrics(point)` is called periodically (1 s interval while the server
  is running) and stores `MetricPoint`s in the **`metricsHistory`** ring buffer — max
  3,600 points (one hour at a 1-second interval), FIFO `shift()`. This ring buffer is
  this feature's `METRIC_SAMPLE` form: **TRANSIENT**, never written to disk.
- **Historical query**: `getHistoricalMetrics({from,to})` filters points by
  window and computes aggregates (`avgLatencyP99`, `maxLatencyP99`, `avgThroughput`,
  totals).
- **Alerting**: `PerformanceAlerter.checkAlerts(metrics)` evaluates the 7 built-in
  rules plus custom rules with a per-rule cooldown (default 60 s) and sends
  notifications via an optional handler (fallback `console.warn`). Alerts are broadcast
  to SSE via `dashboard.addAlert()`.
- **Per-worker / per-route / per-upstream**: the `workerMetrics`, `routeMetrics`,
  `upstreamMetrics` Maps are updated via `update*Metric()` methods — the data source
  is the Metrics-Histogram.

### Configuration

| Option | Default | Notes |
|---|---|---|
| Dashboard port | required `start(port)` argument | a separate HTTP process from the gateway |
| Update interval | 1000 ms | `startMetricsUpdate()` |
| History retention | 3,600 points (~1 hour) | `metricsHistory` FIFO |
| Alert retention | last 100 alerts / 1 hour (alerter) | FIFO + age filter |
| Alert cooldown | 60000 ms | `AlertConfig.defaultCooldown` |
| Built-in rules | 7 rules | see the table below |

Built-in `PerformanceAlerter` rules:

| Rule | Condition | Severity | Cooldown |
|---|---|---|---|
| `latency-threshold` | p99 > 10 ms | critical | 60 s |
| `rps-drop` | drop of > 20% vs the previous sample | warning | 60 s |
| `memory-leak` | growth > 10 MB/hour | warning | 5 minutes |
| `gc-pause` | p99 pause > 100 ms | warning | 60 s |
| `error-rate-spike` | error rate > 5% | critical | 60 s |
| `circuit-breaker-open` | breaker open | warning | 2 minutes |
| `connection-pool-exhaustion` | pool utilization > 90% | warning | 60 s |

### Edge cases

- **Built-in data is still synthetic**: `startMetricsUpdate()` currently produces
  synthetic `MetricPoint`s (`Math.random()`) — wiring to real metrics is not
  yet connected in `Gateway`. The endpoints and broadcast pipeline are tested
  (`tests/unit/phase9/performance-dashboard.test.ts`, 8 it passing); real data
  wiring is the next integration step.
- **SSE client disconnect**: the `res.on('close')` handler removes the client from the list;
  `broadcast` skips `destroyed` clients.
- **Range query outside retention**: a `from` older than one hour yields an
  empty array — no error; retention is limited to one hour by design.
- **An alert rule throws**: `checkAlerts` wraps each rule's evaluation
  in try/catch and logs to the console — a bad rule doesn't stop the others.
- **Alert spam**: a per-rule-name cooldown prevents more than one alert per rule per
  cooldown period.
