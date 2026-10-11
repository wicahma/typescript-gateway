---
title: "Utilitas (Utilities)"
description: "Helper tanpa dependensi untuk logging, metrik internal, dan object pooling."
---

Modul utilitas menampung utilitas internal yang dapat digunakan kembali termasuk logging JSON terstruktur, penghitung performa beroverhead rendah, dan pool objek memori. Helper ini dioptimalkan secara khusus untuk meminimalkan beban garbage collection pada hot path berthroughput tinggi. Utilitas ini digunakan secara luas di seluruh perutean inti dan lapisan eksekusi kebijakan.

## Ekspor (Exports)

| Simbol | Jenis | Tanda Tangan | Tujuan |
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

## Catatan (Notes)

### Logger
Logger JSON terstruktur yang menulis langsung ke stdout dengan filter tingkat log yang dapat dikonfigurasi.

### ObjectPool
Pool daur ulang berukuran tetap untuk objek konteks guna menghindari churn alokasi memori per permintaan.

### Metrics
Ring buffer ringan yang melacak histogram waktu dan inkremen penghitung.

## Sumber (Source)

- `src/utils/logger.ts`
- `src/utils/metrics.ts`
- `src/utils/pool.ts`

## Lihat juga (See also)

- [Pendalaman: Observabilitas](/id/docs/deep-dive/observability/)
