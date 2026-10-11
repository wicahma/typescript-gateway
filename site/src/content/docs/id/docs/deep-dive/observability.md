---
title: "Observabilitas"
description: "Metrik bebas-lock, structured logging, live dashboard, dan in-process profiling."
---

Setiap fitur di grup ini sudah **terimplementasi dan terverifikasi**, masing-masing dengan cakupan unit dan integration test di test suite repo.

## Apa yang Dilakukannya (What it does)

Subsistem observabilitas menyediakan telemetri ber-overhead rendah, structured logging berbasis JSON, pengumpulan metrik bebas lock, diagnostik dashboard terminal langsung, dan CPU/memory profiling sesuai permintaan.

### CPU & Memory Profiler

Toolkit diagnostik dalam proses yang memanfaatkan fitur bawaan V8 di Node.js:
- **CPU Sampling (`CPUProfiler`)**: Menangkap sampel call stack melalui V8 Inspector Session atau sampling stack error ringan, menghasilkan flame graph format collapsed-stack.
- **Diagnostik Heap (`MemoryProfiler`)**: Menghasilkan dump `.heapsnapshot` ke direktori `heapdumps/`, melacak laju pertumbuhan memori (MB/jam), dan menandai ambang kebocoran.
- **Analisis Bentuk Objek V8**: Memeriksa stabilitas hidden class dan memperingatkan call-site polimorfik.

### Metrik Bebas-Lock & Histogram Latensi

Pengumpulan metrik performa tinggi yang menghindari beban garbage collector:
- **Ring-Buffer Histogram (`LatencyHistogram`)**: Array sampel terbatas (10.000 sampel) dengan penulisan O(1) dan pengurutan persentil yang ditunda hingga waktu baca.
- **Histogram Atomik (`MetricsAggregator`)**: Menerapkan counter dan bucket histogram bebas lock berbasis `Int32Array` menggunakan `Atomics`, kompatibel dengan worker `SharedArrayBuffer`.
- **Eksposisi Prometheus**: Format teks standar Prometheus tersedia di `/metrics` melalui header `Accept: text/plain` atau parameter `?format=prometheus`.

### Native Structured Logger

Pencatat log JSON berkecepatan tinggi dengan pemisah baris baru:
- **Write ter-buffer**: baris terakumulasi di memori dan di-flush pada 64 KiB atau setelah 1 detik, menggantikan satu `process.stdout.write` per baris (2447 ns/op) dengan satu write per batch (276 ns/op).
- **Timestamp ter-cache**: timestamp ISO dihitung sekali per detik utuh (72 ns/op) alih-alih per baris (837 ns/op).
- **Pengayaan Context**: Menyisipkan `requestId`, timestamp, pengenal rute, dan durasi latensi.

### Live Performance Dashboard

Dashboard operasional berbasis terminal (`src/dashboard/index.ts`) yang menyediakan visualisasi ASCII langsung untuk RPS, latensi p50/p95/p99, kesehatan upstream, dan alokasi memori.

### Sampling Access Log

Rasio sampling (`monitoring.sampling.rate`) mencatat persentase request sukses yang representatif sambil tetap mencatat 100% error server (HTTP >= 500). Rasio dikonversi menjadi interval: `0.5` mencatat setiap request kedua, `0.1` setiap kesepuluh.

## Konfigurasi (Configuration)

Pengaturan observabilitas dikelola melalui blok konfigurasi `monitoring` dan nilai bawaan kode:

| Opsi | Tipe | Nilai Bawaan | Dampak |
| --- | --- | --- | --- |
| `monitoring.metrics.enabled` | boolean | `true` | Menambahkan tampilan per-route dan per-upstream ke payload `/metrics`. |
| `monitoring.export.prometheus.path` | string | `"/metrics"` | Path endpoint metrik. Path default tetap terdaftar untuk kompatibilitas saat path kustom diset. |
| `monitoring.sampling.rate` | number | `1.0` | Rasio sampling log akses (0.0 hingga 1.0). `1.0` mencatat setiap request; `0.5` setiap request kedua; `0.1` setiap kesepuluh. Response dengan status `>= 500` selalu dicatat terlepas dari rasio. |

Blok `monitoring` opsional secara keseluruhan, tetapi tipe `MonitoringConfig` mendeklarasikan setiap sub-field sebagai wajib, jadi menyediakan `monitoring` berarti menyediakan bentuk lengkapnya (`metrics`, `health`, `export.prometheus`, `tracing`, `sampling`, `logging`). Loader tidak memvalidasi mendalam atau mengisi default blok ini — tiga field di atas adalah satu-satunya yang dibaca runtime.

Level log bukan bagian dari file config: ia dibaca dari environment variable `LOG_LEVEL` (`trace`, `debug`, `info`, `warn`, `error`, `fatal`), default `info`. Tidak ada key `monitoring.logging.level` atau `monitoring.logging.format` — keluaran log selalu JSON dengan pemisah baris baru.

### Buffering log

Baris log di-buffer di memori dan di-flush saat salah satu ambang tercapai:

- **Ukuran**: 64 KiB output terakumulasi (`FLUSH_BYTES`).
- **Waktu**: 1 detik sejak baris pertama yang belum di-flush (`FLUSH_MS`).

Hook `process.on('exit')` mem-flush sisa buffer, dan `logger.flush()` memaksa flush sesuai permintaan. Batching menggantikan satu `process.stdout.write` per baris (terukur 2447 ns/op) dengan satu write per batch (276 ns/op) — 8.9x lebih murah di jalur logging. Timestamp di-cache per detik utuh (72 ns/op vs 837 ns/op untuk `toISOString()` baru).

Jika `destination` diset, batch ditambahkan dengan `appendFileSync`; kegagalan write jatuh kembali ke `process.stdout.write`.

## Interaksi Pipeline (Interactions)

Observabilitas menginstrumentasi setiap tahapan siklus hidup request:

1. **Inisialisasi Context**: `RequestContext` menetapkan `requestId` unik dan mencatat timestamp monotonik awal (`process.hrtime.bigint()`).
2. **Eksekusi Pipeline**: Eror, pembatasan kuota, dan transisi circuit breaker meningkatkan metrik counter terkait.
3. **Penyelesaian Respons**: Status akhir, durasi waktu, dan ukuran byte diteruskan ke access logger dan dicatat ke histogram latensi.
4. **Scraping Endpoint**: Endpoint `/metrics` membaca histogram atomik agregat tanpa menghentikan atau mengunci pipeline request yang sedang aktif.

## Tradeoff dan Mode Kegagalan (Tradeoffs and failure modes)

- **Snapshot Heap Sinkron**: Pemanggilan `v8.writeHeapSnapshot()` memblokir event loop Node.js secara sinkron selama beberapa detik pada ukuran heap besar. Snapshot heap hanya boleh dipicu sesuai permintaan dalam sesi diagnostik khusus.
- **Sampling vs Detail Observabilitas**: Mencatat setiap request pada 100k RPS menghasilkan beban I/O disk yang masif. Sampling log akses mengurangi beban I/O sambil menjamin visibilitas penuh pada semua kegagalan.
- **Biaya Scrape Prometheus**: Pembuatan teks metrik Prometheus membutuhkan pembacaan dan pengurutan persentil histogram. Interval scrape sebaiknya dijaga wajar (10-15 dtk) untuk mencegah lonjakan CPU.
- **Ring Buffer Memori Statis**: Histogram latensi beroperasi pada ring buffer berukuran tetap untuk mencegah pertumbuhan memori, yang berarti data lama secara berkala tertimpa oleh sampel baru.
