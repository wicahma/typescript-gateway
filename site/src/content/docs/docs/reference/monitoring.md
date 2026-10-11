---
title: "Performance Monitoring"
description: "Latency tracking, performance alerts, threshold triggers, and real-time dashboards."
---

The monitoring module collects runtime telemetry, assesses latency thresholds, and triggers alert notifications when health targets are breached. It powers the built-in terminal performance dashboard and maintains rolling statistical windows of request durations and status codes. It provides operations teams with immediate visibility into gateway health.

## Exports

| Symbol | Kind | Signature | Purpose |
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

## Notes

### PerformanceDashboard
Renders live ANSI terminal charts displaying P50, P95, and P99 latency alongside error rates.

### PerformanceAlerts
Configurable alerting engine triggering webhooks or logs when error rates or latency spike above limits.

## Source

- `src/monitoring/performance-alerts.ts`
- `src/monitoring/performance-dashboard.ts`

## See also

- [Deep Dive: Observability](/docs/deep-dive/observability/)
