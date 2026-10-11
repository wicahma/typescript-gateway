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

Pencatat log JSON berkecepatan tinggi yang menulis langsung ke `process.stdout.write`:
- **Nol Alokasi String**: Menghindari pemborosan memori akibat format string pada jalur request utama.
- **Pengayaan Context**: Menyisipkan `requestId`, timestamp, pengenal rute, dan durasi latensi.

### Live Performance Dashboard

Dashboard operasional berbasis terminal (`src/dashboard/index.ts`) yang menyediakan visualisasi ASCII langsung untuk RPS, latensi p50/p95/p99, kesehatan upstream, dan alokasi memori.

### Sampling Access Log

Strategi sampling head/tail yang dapat dikonfigurasi untuk mencatat persentase request sukses yang representatif sambil tetap mencatat 100% respons eror (HTTP >= 400).

## Konfigurasi (Configuration)

Pengaturan observabilitas dikelola melalui blok konfigurasi `monitoring` dan nilai bawaan kode:

| Opsi | Tipe | Nilai Bawaan | Dampak |
| --- | --- | --- | --- |
| `monitoring.metrics.enabled` | boolean | `true` | Mengaktifkan pengumpulan metrik latensi dan throughput. |
| `monitoring.metrics.path` | string | `"/metrics"` | Endpoint path untuk mengekspos metrik Prometheus dan JSON. |
| `monitoring.logging.level` | string | `"info"` | Level log minimum (`debug`, `info`, `warn`, `error`). |
| `monitoring.logging.format` | string | `"json"` | Format keluaran log (`json`, `text`). |
| `monitoring.sampling.rate` | number | `1.0` | Rasio sampling log akses request masuk (0.0 hingga 1.0). |
| `monitoring.sampling.alwaysLogErrors` | boolean | `true` | Memaksa pencatatan log untuk semua request dengan status >= 400. |
| `profiler.samplingInterval` | number | `1000` | Interval sampling CPU profiling dalam mikrodetik. |
| `profiler.maxSamples` | number | `10000` | Jumlah sampel stack maksimum sebelum otomatis berhenti. |
| `memory.retentionDays` | number | `7` | Durasi hari penyimpanan file snapshot heap di disk. |

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
