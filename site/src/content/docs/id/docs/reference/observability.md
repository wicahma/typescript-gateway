---
title: "Eksportir Observabilitas (Observability Exporters)"
description: "Serializer format teks Prometheus dan penangan eksposisi metrik."
---

Modul observabilitas memformat telemetri runtime ke dalam format eksposisi standar terbuka untuk sistem scraping eksternal. Modul ini menserialisasikan penghitung, pengukur (gauges), dan histogram internal ke dalam format teks eksposisi Prometheus (0.0.4). Modul ini memungkinkan scraper standar seperti Prometheus dan kolektor OpenTelemetry untuk membaca metrik gateway tanpa agen khusus.

## Ekspor (Exports)

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `formatPrometheus` | function | `function formatPrometheus(snapshot: Record<string, unknown>): string` | Function export for formatPrometheus. |

## Catatan (Notes)

### PrometheusFormat
Menserialisasikan struktur metrik internal ke format teks baris Prometheus yang valid dengan baris metadata HELP dan TYPE.

## Sumber (Source)

- `src/observability/prometheus-format.ts`

## Lihat juga (See also)

- [Pendalaman: Observabilitas](/id/docs/deep-dive/observability/)
