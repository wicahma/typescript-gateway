---
title: "Observability Exporters"
description: "Prometheus text format serializer and metrics exposition handlers."
---

The observability module formats runtime telemetry into open standard exposition formats for external scraping systems. It serializes internal counters, gauges, and histograms into Prometheus exposition text format (0.0.4). This module allows standard scrapers like Prometheus and OpenTelemetry collectors to consume gateway metrics without custom agents.

## Exports

| Symbol | Kind | Signature | Purpose |
| --- | --- | --- | --- |
| `formatPrometheus` | function | `function formatPrometheus(snapshot: Record<string, unknown>): string` | Function export for formatPrometheus. |

## Notes

### PrometheusFormat
Serializes internal metrics structures to valid Prometheus line format text with HELP and TYPE metadata lines.

## Source

- `src/observability/prometheus-format.ts`

## See also

- [Deep Dive: Observability](/docs/deep-dive/observability/)
