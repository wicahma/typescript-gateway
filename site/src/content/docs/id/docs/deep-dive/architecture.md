---
title: "Arsitektur & Pipeline"
description: "Mengintip ke dalam request pipeline tanpa dependency dan tanpa alokasi."
---

## Apa yang Dilakukannya (What it does)

TypeScript Gateway menjalankan engine reverse proxy HTTP tanpa dependency runtime yang dirancang dengan siklus hidup request tanpa alokasi memori. Pilar arsitektur utamanya meliputi:

1. **Tanpa Runtime Dependency**: Tidak menggunakan library eksternal. Semua logging, routing, validasi, dan proxy streaming hanya mengandalkan library standar Node (`node:http`, `node:crypto`, `node:stream`).
2. **Hot Path Tanpa Alokasi**: Context, buffer parameter, dan metadata response didaur ulang menggunakan Object Pool di memori untuk mencegah jeda V8 Garbage Collector.
3. **Resilience Dulu**: Circuit breaker, retry manager dengan exponential jitter, connection pooling, dan active health check adalah tahapan bawaan pipeline.
4. **Overhead Internal Sub-milidetik**: Dispatch route statis O(1), pencarian radix tree O(log n).

### Alur Request Lifecycle

```
Incoming Client Request
        │
        ▼
[ node:http Server (Keep-Alive Pool) ]
        │
        ▼
[ Context Pool (Acquire RequestContext) ]
  • High-resolution timestamp
  • Request ID generation
  • Parameter maps reset
        │
        ▼
[ Radix Tree Router ]
  • Exact match O(1)
  • Parametric segment O(log n)
        │
   ┌────┴───────────────────────────┐
   ▼                                ▼
Built-in Route                  Proxy Route
(/health, /metrics, /)          (/api/*, custom)
Direct Response                     │
                                    ▼
                        [ Plugin Chain: preRoute ]
                        • Rate Limiter (Token bucket / Sliding window)
                        • Request ID injection
                                    │
                                    ▼
                        [ Request Transformer ]
                        • Header injection / removal
                        • Path prefix rewriting
                                    │
                                    ▼
                        [ Load Balancer (5 Algorithms) ]
                        • Round Robin, Least Conn, Weighted, IP Hash, Random
                        • Filter healthy targets only
                                    │
                                    ▼
                        [ Circuit Breaker Guard ]
                        • CLOSED -> Forward
                        • OPEN -> Instant 503 / Fallback
                        • HALF-OPEN -> Probe canary
                                    │
                                    ▼
                        [ HTTP Client Connection Pool ]
                        • Stream request body
                        • Exponential Retry with Jitter on failure
                                    │
                                    ▼
                        [ Response Transformer & Compression ]
                        • Status code mapping
                        • Native gzip / brotli / deflate stream
                                    │
                                    ▼
                        [ Release to Client ]
                                    │
                                    ▼
[ Context Pool (Recycle RequestContext) ]
[ Metrics Aggregator: Record Latency ]
```

### Komponen Utama

- **Radix Router (`src/core/router.ts`)**: Menggabungkan tabel hash untuk pencarian O(1) route statis dan radix prefix tree terkompresi untuk route dinamis (`/users/:id`).
- **Upstream Connection Pool (`src/core/http-client-pool.ts`)**: Menjaga koneksi soket tetap terbuka menggunakan `http.Agent` dengan optimasi TCP keep-alive, memaksimalkan penggunaan ulang soket.
- **Circuit Breaker (`src/core/circuit-breaker.ts`)**: Menerapkan state machine circuit breaker per target upstream untuk menghentikan pengiriman trafik ke backend yang bermasalah.
- **Native Structured Logger (`src/utils/logger.ts`)**: Logger JSON terstruktur non-blocking yang menulis langsung ke `process.stdout.write`.

## Konfigurasi (Configuration)

Parameter arsitektur dikonfigurasi melalui blok `server` dan `performance` pada `gateway.config.json`:

| Opsi | Tipe | Nilai Bawaan | Dampak |
| --- | --- | --- | --- |
| `server.port` | number | `3000` | Port tempat HTTP server mendengarkan koneksi masuk. |
| `server.host` | string | `"0.0.0.0"` | Alamat antarmuka jaringan tempat server terikat. |
| `server.keepAlive` | boolean | `true` | Mengaktifkan koneksi TCP keep-alive persisten pada soket klien. |
| `server.keepAliveTimeout` | number | `65000` | Durasi dalam milidetik sebelum menutup soket klien yang tidak aktif. |
| `server.requestTimeout` | number | `30000` | Batas waktu maksimum dalam milidetik sebelum membatalkan request masuk. |
| `server.maxHeaderSize` | number | `16384` | Batas ukuran maksimum header HTTP masuk dalam byte. |
| `server.maxBodySize` | number | `10485760` | Batas ukuran maksimum payload body request masuk dalam byte (10 MB). |
| `performance.contextPoolSize` | number | `1000` | Jumlah instance `RequestContext` yang dialokasikan di muka dalam pool memori. |
| `performance.enablePooling` | boolean | `true` | Mengaktifkan penggunaan kembali buffer dan context dari pool memori. |

## Interaksi Pipeline (Interactions)

Arsitektur ini mendefinisikan urutan eksekusi seluruh tahapan request pipeline:

1. **Ingress**: `node:http.Server` mem-parsing header HTTP dan menyalurkan soket ke pipeline.
2. **Peminjaman Context**: `RequestContextPool` meminjam context bersih dan mencatat timestamp awal.
3. **Pencarian Route**: `RadixRouter` mencocokkan route dan menentukan target upstream yang dituju.
4. **Pre-processing**: Plugin terdaftar mengeksekusi lifecycle hook masuk (`preRoute`, `preHandler`).
5. **Penerusan Upstream**: `HttpClientPool` mengalirkan body request ke target upstream terpilih.
6. **Post-processing**: Kompresi dan transformasi response dieksekusi sebelum mengirim byte ke klien.
7. **Pengembalian Context**: Objek context dibersihkan dan dikembalikan ke pool, memperbarui metrik latensi.

## Tradeoff dan Mode Kegagalan (Tradeoffs and failure modes)

- **Object Pool vs Alokasi Dinamis**: Pool memori mencegah lonjakan garbage collection V8 pada throughput tinggi. Jika jumlah request bersamaan melebihi `contextPoolSize`, gateway mengalokasikan context sementara secara dinamis dan kembali ke GC standar sampai beban mereda.
- **Saturasi Connection Pool**: Pool soket membatasi konkurensi per upstream. Saat backend melambat, request klien mengantre di belakang soket yang tersedia hingga mencapai `requestTimeout`, memicu respons 504 Gateway Timeout.
- **Pemutusan Soket Klien**: Jika klien memutuskan koneksi di tengah jalan, gateway mendeteksi event abort, membatalkan streaming ke upstream, dan segera membebaskan context ke pool.
