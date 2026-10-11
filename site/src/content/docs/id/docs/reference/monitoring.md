---
title: "Pemantauan Performa (Performance Monitoring)"
description: "Pelacakan latensi, peringatan performa, ambang batas, dan dasbor waktu nyata."
---

Modul pemantauan mengumpulkan telemetri runtime, menilai ambang batas latensi, dan memicu notifikasi peringatan saat target kesehatan terlampaui. Modul ini mentenagai dasbor performa terminal bawaan dan mengelola jendela statistik bergulir dari durasi permintaan dan kode status. Modul ini memberi tim operasi visibilitas langsung ke dalam kesehatan gateway.

## Ekspor (Exports)

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `AlertSeverity` | type | `type AlertSeverity = 'info' \| 'warning' \| 'critical'` | Alert severity levels |
| `Metrics` | interface | `interface Metrics` | Metrics for alert evaluation |
| `AlertRule` | interface | `interface AlertRule` | Alert rule definition |
| `Alert` | interface | `interface Alert` | Active alert |
| `AlertConfig` | interface | `interface AlertConfig` | Alert configuration |
| `PerformanceAlerter` | class | `class PerformanceAlerter` | Performance Alerter |
| `TimeRange` | interface | `interface TimeRange` | Time range for historical queries |
| `HistoricalMetrics` | interface | `interface HistoricalMetrics` | Historical metrics data |
| `MetricPoint` | interface | `interface MetricPoint` | Single metric point |
| `MetricAggregates` | interface | `interface MetricAggregates` | Metric aggregates |
| `WorkerMetrics` | interface | `interface WorkerMetrics` | Worker metrics |
| `RouteMetrics` | interface | `interface RouteMetrics` | Route metrics |
| `UpstreamMetrics` | interface | `interface UpstreamMetrics` | Upstream metrics |
| `PerformanceAlert` | interface | `interface PerformanceAlert` | Performance alert |
| `EventStream` | class | `class EventStream extends EventEmitter` | Event stream for SSE |
| `PerformanceDashboard` | class | `class PerformanceDashboard` | Performance Dashboard |

## Catatan (Notes)

### PerformanceDashboard
Menampilkan grafik terminal ANSI langsung yang menampilkan latensi P50, P95, dan P99 bersama dengan tingkat kesalahan.

### PerformanceAlerts
Mesin peringatan yang dapat dikonfigurasi yang memicu webhook atau log saat tingkat kesalahan atau latensi melonjak di atas batas.

## Sumber (Source)

- `src/monitoring/performance-alerts.ts`
- `src/monitoring/performance-dashboard.ts`

## Lihat juga (See also)

- [Pendalaman: Observabilitas](/id/docs/deep-dive/observability/)
