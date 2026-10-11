---
title: "Utilities"
description: "Zero-dependency helpers for logging, internal metrics, and object pooling."
---

The utils module houses reusable internal utilities including structured JSON logging, low-overhead performance counters, and memory object pools. These helpers are specifically optimized to minimize garbage collection pressure on high-throughput hot paths. They are used universally across core routing and policy execution layers.

## Exports

| Symbol | Kind | Signature | Purpose |
| --- | --- | --- | --- |
| `LogLevel` | enum | `enum LogLevel` | Enum export for LogLevel. |
| `LoggerConfig` | interface | `interface LoggerConfig` | Interface export for LoggerConfig. |
| `LogContext` | interface | `interface LogContext` | Interface export for LogContext. |
| `Logger` | interface | `interface Logger` | Interface export for Logger. |
| `createLogger` | function | `function createLogger(config: Partial<LoggerConfig> = {}): Logger` | Function export for createLogger. |
| `logger` | const | `const logger = createLogger(` | Const export for logger. |
| `StructuredLogger` | class | `class StructuredLogger` | Class export for StructuredLogger. |
| `createRequestLogger` | function | `function createRequestLogger()` | Function export for createRequestLogger. |
| `logSlowRequest` | function | `function logSlowRequest(method: string, path: string, latencyMs: number, threshold: number` | Function export for logSlowRequest. |
| `MetricsCollector` | class | `class MetricsCollector` | Metrics collector for gateway performance monitoring Uses lock-free counters and circular buffers |
| `metrics` | const | `const metrics = new MetricsCollector()` | Export singleton instance |
| `Poolable` | interface | `interface Poolable` | Poolable object interface Objects in pool must implement reset method |
| `PoolStats` | interface | `interface PoolStats` | Pool statistics for monitoring |
| `PoolFactory` | type | `type PoolFactory<T> = () => T` | Factory function for creating new pool objects |
| `ObjectPool` | class | `class ObjectPool<T extends Poolable>` | Generic object pool implementation Fixed-size pool with overflow handling |
| `BufferPool` | class | `class BufferPool` | Buffer pool for reusing byte buffers Uses wrapper class to avoid monkey-patching Buffer prototype |

## Notes

### Logger
Structured JSON logger writing directly to stdout with configurable log level filters.

### ObjectPool
Fixed-size recycling pool for context objects to avoid per-request memory allocation churn.

### Metrics
Lightweight ring buffer tracking timing histograms and counter increments.

## Source

- `src/utils/logger.ts`
- `src/utils/metrics.ts`
- `src/utils/pool.ts`

## See also

- [Deep Dive: Observability](/docs/deep-dive/observability/)
