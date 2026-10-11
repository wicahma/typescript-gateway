---
title: "Matriks Fitur"
description: "Semua 52 fitur di 7 grup, beserta status implementasinya."
---

Semua 52 fitur di 7 grup, masing-masing didukung oleh cakupan unit dan integration test. 1075/1075 tes hijau.

## Apa yang Dilakukannya (What it does)

Gateway mengimplementasikan 52 kapabilitas berbeda yang terbagi dalam tujuh subsistem fungsional utama. Setiap fitur di bawah ini telah terverifikasi dalam test suite otomatis.

| Grup | Fitur | Status |
|---|---|---|
| Core Routing | Radix Router | implemented |
| Core Routing | Reverse Proxy Handler | implemented |
| Core Routing | Request Pipeline | implemented |
| Core Routing | Request Context Pool | implemented |
| Core Routing | WebSocket Tunneling | implemented |
| Core Routing | OpenAPI Generator | implemented |
| Core Routing | Client Disconnect Propagation | implemented |
| Core Routing | Request Coalescing | implemented |
| Core Routing | Streaming Response Path | implemented |
| Resilience | Circuit Breaker | implemented |
| Resilience | Retry Manager | implemented |
| Resilience | Health Checker | implemented |
| Resilience | Fallback Handler | implemented |
| Resilience | Timeout Manager | implemented |
| Traffic Control | Rate Limiter | implemented |
| Traffic Control | Response Cache | implemented |
| Traffic Control | Load Balancer | implemented |
| Payload | Body Parser | implemented |
| Payload | Request Transformer | implemented |
| Payload | Response Transformer | implemented |
| Payload | Compression Handler | implemented |
| Observability | Metrics Histogram | implemented |
| Observability | Native Structured Logger | implemented |
| Observability | Performance Dashboard | implemented |
| Observability | Access Log Sampling | implemented |
| Observability | CPU & Memory Profiler | implemented |
| Operations | Config Loader & Validator | implemented |
| Operations | Plugin Execution Chain | implemented |
| Operations | Auto Tuner | implemented |
| Identity & Security | JWT Auth Plugin | implemented |
| Identity & Security | API Key Engine | implemented |
| Identity & Security | Upstream Credential Injection | implemented |
| Identity & Security | RFC 7807 Problem Details | implemented |
| Resilience | Traffic Shadowing | implemented |
| Identity & Security | Inbound HMAC Verification | implemented |
| Traffic Control | Daily Quota (per consumer) | implemented |
| Identity & Security | SSRF Guard | implemented |
| Identity & Security | Security Headers | implemented |
| Operations | Admin Control Plane | implemented |
| Traffic Control | Sticky Sessions | implemented |
| Core Routing | OpenAPI {param} Syntax | implemented |
| Core Routing | Regex-Group Path Params | implemented |
| Core Routing | OpenAPI Route Source | implemented |
| Traffic Control | CORS Policy | implemented |
| Observability | W3C Trace Context | implemented |
| Identity & Security | Outbound Secret Masking | implemented |
| Traffic Control | Idempotency Keys | implemented |
| Resilience | Adaptive Load Shedding | implemented |
| Resilience | Concurrency Limiter | implemented |
| Operations | Request Record Store | implemented |
| Operations | Request Replay | implemented |
| Observability | Audit Event Stream | implemented |

## Konfigurasi (Configuration)

Fitur-fitur dideklarasikan, diaktifkan, dan disesuaikan secara terpusat melalui `config/gateway.config.json`:

| Area Fitur | Jalur Konfigurasi | Pengaturan Utama |
|---|---|---|
| Routing & Upstream | `routes`, `upstreams` | Metode HTTP, pola path, URL target origin, batas timeout. |
| Ketahanan (Resilience) | `upstreams[].healthCheck`, `plugins[circuit-breaker]` | Interval health check, ambang eror, waktu cooldown circuit breaker. |
| Manajemen Trafik | `plugins[rate-limit]`, `plugins[cache]` | Ukuran window, batas token, limit TTL cache, ekstraktor kunci. |
| Keamanan | `apiKeys`, `plugins[auth-jwt]` | Kunci JWKS, nama header API key, validasi issuer/audience. |
| Performa | `performance` | Jumlah worker, ukuran memory pool, kapasitas buffer. |

## Interaksi Pipeline (Interactions)

Fitur-fitur bekerja sama dalam pipeline berlapis yang terstruktur:
1. **Jaringan & Ingress**: Server HTTP bawaan menerima koneksi soket dan mengalokasikan `RequestContext` dari pool memori.
2. **Keamanan Pre-Routing**: Verifikasi API Key dan token JWT memvalidasi identitas serta menegakkan kuota rate limit.
3. **Pencocokan Rute**: Radix Router memilih target upstream berdasarkan metode HTTP dan pola path.
4. **Ketahanan & Proxy**: Circuit breaker, retry manager, dan reverse proxy handler meneruskan request ke origin upstream.
5. **Pasca-Pemrosesan & Telemetri**: Transformer memodifikasi header atau body, log akses dicatat, dan counter metrik diperbarui secara atomik.

## Tradeoff dan Mode Kegagalan (Tradeoffs and failure modes)

### Tolok Ukur (Benchmarks)

Diukur pada mesin target referensi (4-core x86_64, Node 22):

| Skenario | Hasil | Target |
|---|---|---|
| Hot target path (load-test, 100 conn) | **P99 5ms · 38.405 RPS** | P99 < 10ms · RPS > 10k ✓ |
| acquire+release pool overhead | 1.5 µs/op | — |
| Circuit breaker CLOSED fast-path | ~1.1 µs/req saved | — |
| Full proxy path @ 100 conn | ~3.2k RPS · P99 ~40ms | hardware-bound ceiling* |

\* Batas atas full-proxy dipengaruhi oleh durasi round-trip loopback pada mesin 4-core bersama (hop raw url-forward saja memerlukan 223 µs/op), bukan beban kode gateway — beban kode gateway di atas raw hop hanya ~28%. Didokumentasikan secara transparan tanpa spekulasi.

### Perilaku Kegagalan

- **Isolasi Subsistem**: Kegagalan pada plugin atau kebijakan ditangani sebagai respons RFC 7807 terstruktur alih-alih merusak proses Node.js utama.
- **Beban Berlebih**: Saat batas konkurensi atau load-shedding terlampaui, gateway menolak beban berlebih dengan HTTP 503 atau 429 daripada membiarkan memori event loop terkuras.
