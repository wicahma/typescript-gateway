---
title: "Observability"
description: "Metrics lock-free, structured logging, dashboard live, dan profiling in-process."
order: 8
section: "Features"
track: "reference"
---

Keempat fitur di grup ini sudah **implemented dan terverifikasi** — masing-masing punya pasangan spek FSD + ERD lengkap dan coverage unit/integration di test suite repo.

## CPU Memory Profiler

Toolkit profiling in-process untuk mendiagnosis CPU dan memori gateway — dibangun di atas Node.js
(`inspector`, `v8`, `process`), tanpa dependency eksternal:

- `src/profiling/cpu-profiler.ts` (453 LOC) — CPU sampling via V8 Inspector
  (`Profiler.start/stop`), analisis hot-function, ekspor flame graph dalam format
  collapsed-stack, dan mode sampling stack-capture yang ringan.
- `src/profiling/memory-profiler.ts` (408 LOC) — heap snapshot (`v8.writeHeapSnapshot`),
  diffing snapshot untuk deteksi leak, allocation tracking, monitoring GC.
- `src/core/memory-optimizer.ts` (396 LOC) — monitoring memori periodik, analisis
  pertumbuhan heap, deteksi leak otomatis, rekomendasi flag GC, laporan memori.
- `src/core/v8-optimizations.ts` (338 LOC) — analisis shape/hidden class, deteksi
  polimorfisme, benchmarking fungsi, helper handler monomorphic.

Tujuan: saat latensi menurun atau memori membengkak, operator bisa menangkap profile
dan snapshot tanpa install tooling eksternal atau restart proses.

### Cara kerja

- **CPU (V8 Inspector)**: `CPUProfiler.startProfiling(duration?)` membuka `Session`,
  `Profiler.enable` + `Profiler.start` dengan `samplingInterval` (default 1000 µs).
  `stopProfiling()` memproses node + sample + timeDeltas menjadi `ProfileResult`
  (selfTime/totalTime per node). `analyzeProfile()` mengurutkan 20 fungsi terpanas
  dengan persentase dari total waktu CPU. `generateFlameGraph()` menulis format
  collapsed-stack (`func (file:line);... count`) siap untuk flamegraph.pl.
- **CPU sampling ringan**: `startSampling(interval)` menangkap stack via
  `new Error().stack` (parse frame teratas dengan regex) — overhead rendah, akurasi
  lebih kasar; berhenti otomatis di `maxSamples` (default 10.000).
- **Memori**: `MemoryProfiler.takeSnapshot()` menulis file `.heapsnapshot` ke
  `heapdumps/`, mencatat `{ id, timestamp, path, size, heapUsed }` ke list in-memory.
  `compareSnapshots()` menghitung `heapGrowth` dan `growthRate` (MB/jam) dan menandai
  leak saat pertumbuhan melebihi 10 MB. `analyzeHeapGrowth(interval, duration)`
  (MemoryOptimizer) mengambil sampel `process.memoryUsage()` secara periodik dan
  menyimpulkan `isLeaking` pada growth rate di atas 10 MB/jam, termasuk pengecekan
  external/arrayBuffers.
- **Monitoring & rekomendasi**: `MemoryOptimizer.startMonitoring(interval)` menyimpan
  history 1000 sampel, menjalankan `detectMemoryLeaks()` periodik (ambang 10 MB/jam,
  level `suspected`/`confirmed`), `getRecommendations()` memberi saran berdasarkan
  utilisasi heap (80%/90%), memori external, dan rata-rata waktu pause GC.
  `forceGC()` tersedia kalau Node dijalankan dengan `--expose-gc`.
- **Optimasi V8**: `analyzeObjectShape()` mengecek konsistensi urutan properti
  (stabilitas hidden class); `PolymorphismDetector` memperingatkan call-site dengan
  lebih dari 4 tipe; `benchmark()` mengukur dampak optimasi (warmup 100 iterasi).

### Konfigurasi

| Option | Default | Location |
|---|---|---|
| `samplingInterval` (CPU) | 1000 µs | `ProfilerConfig` |
| `maxSamples` | 10000 | `ProfilerConfig` |
| `includeNative` | false | `ProfilerConfig` |
| Interval sampling ringan | 100 ms | `startSampling(interval)` |
| `snapshotPath` | `<cwd>/heapdumps` | `MemoryProfilerConfig` |
| `retentionDays` | 7 | pembersihan snapshot lama |
| `autoSnapshot` / `autoSnapshotInterval` | false / 3600000 ms | snapshot otomatis |
| Ambang leak | 10 MB/jam | `analyzeHeapGrowth` / `detectMemoryLeaks` |
| Interval monitoring | 10000 ms | `MemoryOptimizer.startMonitoring` |

Tidak ada field di `gateway.config.json` — profiler diaktifkan secara programatik
(diagnosis on-demand), bukan always-on.

### Edge case

- **Profiling ganda**: `startProfiling()` saat sesi aktif melempar
  `Error('Profiling already in progress')`; `stopProfiling()` tanpa sesi melempar
  `Error('No profiling session active')`.
- **File snapshot**: `writeHeapSnapshot` sinkron dan memblokir event loop selama
  beberapa detik di heap besar — pakai untuk diagnosis, bukan rutin di produksi sibuk.
- **Perbandingan snapshot**: analisis leak per-tipe masih disederhanakan
  (deteksi berdasarkan pertumbuhan total, bukan parsing snapshot) — didokumentasikan
  jujur di kode sebagai implementasi yang disederhanakan.
- **Monitor GC**: `GCMonitorImpl.start()` belum memasang `PerformanceObserver` —
  daftar event kosong sampai implementasinya selesai (kode mendokumentasikan ini).
- **`forceGC()` tanpa `--expose-gc`**: warning di console, tidak crash; statistik GC
  tidak tercatat.
- **Retensi snapshot**: `cleanupSnapshots()` menghapus file lebih tua dari
  `retentionDays`; referensi in-memory dibatasi 10 terakhir (MemoryOptimizer).


## Metrics Histogram

Kolektor metrik latensi dan counter untuk gateway, dirancang supaya overhead pengukuran
bisa diabaikan dibanding latensi request itu sendiri. Tiga lapisan:

1. `MetricsCollector` (`src/utils/metrics.ts`) — counter lock-free + histogram
   ring-buffer 10.000 sampel, singleton `metrics`.
2. `MetricsAggregator` (`src/core/metrics-aggregator.ts`) — histogram berbasis
   `Int32Array(310)` dengan operasi `Atomics.*` (lock-free, siap dipakai lintas worker
   via `SharedArrayBuffer`), plus sliding window 60 detik.
3. `AdvancedMetrics` (`src/core/advanced-metrics.ts`) — metrik domain: per-route,
   per-upstream, transformasi, kompresi, WebSocket, error rate (window 1/5/15 menit),
   statistik retry, timeout, dan circuit breaker.

Tujuan: latensi p50/p95/p99, RPS, error rate, dan throughput tersedia kapan saja
(`GET /metrics`) tanpa tekanan garbage-collection yang berarti.

### Cara kerja

- **Histogram ring-buffer** (`LatencyHistogram`, default 10.000 sampel): setiap
  `record(latencyMs)` menulis ke slot `index % size`. Saat buffer penuh, sampel lama
  ditimpa (memori tetap, tidak tumbuh). Persentil dihitung dengan mengurutkan salinan
  sampel saat `snapshot()` dipanggil — O(n log n) hanya di jalur baca, bukan jalur tulis.
- **Histogram atomic** (`MetricsAggregator`): 100 bucket distribusi log per dimensi
  (latensi 1–100 ms, ukuran request/response 100 B–10 KB), plus 10 slot counter.
  Increment memakai `Atomics.add` sehingga aman di bawah akses konkuren dan bisa
  dibagikan ke worker_threads via `getSharedBuffer()`.
- **Sliding window**: setiap record juga masuk ke `WindowEntry[]` (maks 10.000 entri,
  umur maks 60 detik) untuk persentil yang lebih akurat atas data terkini
  (`getWindowSnapshot()`).
- **Metrik domain** (`AdvancedMetrics`): agregasi inkremental (count/total/avg/min/max)
  per route dan upstream; error rate dihitung dari history timestamp yang dipangkas
  ke window terbesar (900 detik).
- Semua entitas metrik in-memory — mati bersama proses. Lihat
FSD dan
ERD.

### Konfigurasi

| Option | Default | Location |
|---|---|---|
| Ukuran histogram ring-buffer | `10000` sampel | `new MetricsCollector(histogramSize)` |
| Aggregator shared-memory | `false` | `new MetricsAggregator({ useSharedMemory })` |
| Ukuran sliding window | `10000` entri / `60000` ms | `new MetricsAggregator({ windowSize, windowDuration })` |
| Window error-rate | `[60, 300, 900]` detik | `AdvancedMetricsConfig.timeWindows` |
| Pelaporan periodik | `60000` ms (log snapshot metrics) | `Gateway.setupMetricsReporting()` |
| Endpoint snapshot | `GET /metrics` | system route, didaftarkan di `src/index.ts` |

Tidak ada field khusus di `gateway.config.json` untuk fitur ini — semuanya
diinstansiasi dengan default di kode (zero-config by design).

### Edge case

- **Latensi di luar rentang bucket**: nilai di-clamp ke rentang histogram (mis. 1–100 ms)
  sebelum pemetaan bucket — tidak ada index out-of-bounds.
- **Snapshot saat buffer belum penuh**: hanya slot terisi yang dihitung
  (flag `filled`); persentil/rata-rata benar sejak request pertama.
- **`totalOriginalSize = 0` di kompresi**: rasio dihitung dari total terakumulasi,
  bukan per-event, jadi event pertama tidak bisa membagi nol.
- **Reset konkuren**: `Atomics.store(…, 0)` di seluruh buffer; sliding window
  dibuang sekaligus. Snapshot yang berjalan konkuren bisa melihat keadaan setengah-reset —
  diterima karena snapshot bersifat best-effort, bukan transaksional.
- **Pertumbuhan history error-rate**: dipangkas di setiap `recordErrorRate` terhadap
  window terbesar (900 dtk); distribusi timeout dibatasi 10.000 durasi terakhir.


## Native Structured Logger

Logger JSON terstruktur bawaan (`src/utils/logger.ts`, 211 LOC) yang
**menggantikan pino** sebagai bagian dari prinsip zero-dependency gateway. Tujuan: logging
sinkron tanpa alokasi pipeline yang tidak perlu — setiap baris adalah
`JSON.stringify(payload) + '\n'` yang ditulis langsung ke `process.stdout.write()`
(opsi `appendFileSync` tersedia saat `destination` file di-set). Format barisnya
kompatibel dengan konsumer log standar: satu objek JSON per baris (NDJSON), field
`level`, `time` (ISO-8601), `pid`, `hostname`, `msg`.

### Cara kerja

- **Enam level**: `TRACE(10) DEBUG(20) INFO(30) WARN(40) ERROR(50) FATAL(60)`.
  `write()` early-return saat bobot level event di bawah level logger aktif —
  pemanggilan `logger.debug()` saat level `info` nyaris gratis (satu perbandingan numerik).
- **Tiga mode payload** di `FastNativeLogger.write()`:
  1. string → `{ level, time, pid, hostname, ...bindings, msg }`;
  2. objek → di-spread sebagai field top-level + `msg` opsional;
  3. selain itu → dibungkus dalam field `data`.
- **Child logger**: `child(bindings)` membuat instance baru dengan bindings yang
  digabung — dipakai oleh `StructuredLogger.component(name)` untuk logger per-komponen
  (Map `componentLoggers` yang di-cache), `withCorrelation(id)` untuk request tracing,
  dan `withContext(ctx)`.
- **`StructuredLogger`** (wrapper kaya fitur): `logRequest`, `logResponse`
  (status ≥ 500 → `error`, ≥ 400 → `warn`, selain itu `info`), `logSlowRequest`
  (ambang default 100 ms), `logError` dengan sampling rate, `updateConfig`
  hot-update (level per-komponen di-reset bersama cache child logger).
- **`createRequestLogger()`**: helper stateless untuk logging request/response/error.
- Level default dibaca dari env var `LOG_LEVEL` (fallback `info`).

### Konfigurasi

| Option | Default | Source |
|---|---|---|
| `level` | `info` / env `LOG_LEVEL` | `LoggerConfig.level` |
| `destination` | unset → stdout | `LoggerConfig.destination` (path file, `appendFileSync`) |
| `pretty` | `false` | ada di interface; implementasi saat ini selalu menulis NDJSON |
| `slowRequestThreshold` | `100` ms | `StructuredLogger` |
| `errorSampling` | `1.0` | fraksi error yang dicatat |
| `componentLevels` | `{}` | override level per nama komponen |
| `enableCorrelationId` | `true` | binding `correlationId` di child logger |

### Edge case

- **Kegagalan tulis ke destination file**: `appendFileSync` dibungkus try/catch —
  fallback ke `process.stdout.write(line)`; log tidak pernah hilang dan proses tidak crash.
- **Level tidak dikenal** di `LEVEL_WEIGHT`: fallback ke bobot 30 (info).
- **Payload bukan objek/string**: dibungkus sebagai `{ data: value }` — tidak pernah
  `JSON.stringify(undefined)` menghasilkan baris kosong.
- **Objek error**: `logError` secara eksplisit mengekstrak `{ name, message, stack }`;
  `JSON.stringify(err)` mentah akan membuang stack.
- **I/O sinkron**: `appendFileSync` memblokir event loop — makanya default-nya
  stdout (pipe async); destination file hanya untuk pemakaian yang disengaja.


## Performance Dashboard

Server HTTP monitoring terpisah (`src/monitoring/performance-dashboard.ts`, 420 LOC)
yang menampilkan metrik performa gateway secara real-time (SSE) dan historis, plus
evaluasi alert-rule (`src/monitoring/performance-alerts.ts`, 283 LOC). Tujuan:
operator bisa melihat p50/p95/p99, throughput, error rate, dan pemakaian memori tanpa
menyentuh endpoint utama gateway — dashboard jalan di port sendiri.

### Cara kerja

- **`PerformanceDashboard.start(port)`** menjalankan `http.createServer` sendiri
  dengan CORS terbuka (`GET, OPTIONS`) dan routing manual ke 6 endpoint `/api/performance/*`.
- **Real-time**: `GET /api/performance/realtime` membuka stream SSE
  (`text/event-stream`). `EventStream` (sebuah EventEmitter) menyimpan daftar
  client `ServerResponse`, menyiarkan event `metrics` / `worker` / `alert` sebagai
  `event: <name>\ndata: <json>\n\n`, dan membuang client yang `destroyed`.
- **History**: `updateMetrics(point)` dipanggil periodik (interval 1 dtk selama server
  jalan) dan menyimpan `MetricPoint` ke ring buffer **`metricsHistory`** — maks
  3.600 titik (satu jam pada interval 1 detik), FIFO `shift()`. Ring buffer ini adalah
  bentuk `METRIC_SAMPLE` fitur ini: **TRANSIENT**, tidak pernah ditulis ke disk.
- **Query historis**: `getHistoricalMetrics({from,to})` memfilter titik berdasarkan
  window dan menghitung agregat (`avgLatencyP99`, `maxLatencyP99`, `avgThroughput`,
  total).
- **Alerting**: `PerformanceAlerter.checkAlerts(metrics)` mengevaluasi 7 rule bawaan
  plus rule kustom dengan cooldown per-rule (default 60 dtk) dan mengirim notifikasi
  via handler opsional (fallback `console.warn`). Alert disiarkan ke SSE via
  `dashboard.addAlert()`.
- **Per-worker / per-route / per-upstream**: Map `workerMetrics`, `routeMetrics`,
  `upstreamMetrics` diperbarui via method `update*Metric()` — sumber datanya adalah
  Metrics-Histogram.

### Konfigurasi

| Option | Default | Notes |
|---|---|---|
| Port dashboard | argumen wajib `start(port)` | proses HTTP terpisah dari gateway |
| Interval update | 1000 ms | `startMetricsUpdate()` |
| Retensi history | 3.600 titik (~1 jam) | `metricsHistory` FIFO |
| Retensi alert | 100 alert terakhir / 1 jam (alerter) | FIFO + filter umur |
| Cooldown alert | 60000 ms | `AlertConfig.defaultCooldown` |
| Rule bawaan | 7 rule | lihat tabel di bawah |

Rule bawaan `PerformanceAlerter`:

| Rule | Condition | Severity | Cooldown |
|---|---|---|---|
| `latency-threshold` | p99 > 10 ms | critical | 60 s |
| `rps-drop` | penurunan > 20% vs sampel sebelumnya | warning | 60 s |
| `memory-leak` | pertumbuhan > 10 MB/jam | warning | 5 menit |
| `gc-pause` | p99 pause > 100 ms | warning | 60 s |
| `error-rate-spike` | error rate > 5% | critical | 60 s |
| `circuit-breaker-open` | breaker open | warning | 2 menit |
| `connection-pool-exhaustion` | utilisasi pool > 90% | warning | 60 s |

### Edge case

- **Data bawaan masih sintetis**: `startMetricsUpdate()` saat ini menghasilkan
  `MetricPoint` sintetis (`Math.random()`) — wiring ke metrik asli belum
  tersambung di `Gateway`. Endpoint dan pipeline broadcast sudah dites
  (`tests/unit/phase9/performance-dashboard.test.ts`, 8 it passing); wiring data asli
  adalah langkah integrasi berikutnya.
- **Client SSE disconnect**: handler `res.on('close')` menghapus client dari daftar;
  `broadcast` melewati client yang `destroyed`.
- **Query range di luar retensi**: `from` yang lebih tua dari satu jam menghasilkan
  array kosong — tanpa error; retensi dibatasi satu jam by design.
- **Rule alert melempar error**: `checkAlerts` membungkus evaluasi tiap rule
  dengan try/catch dan log ke console — rule yang rusak tidak menghentikan yang lain.
- **Spam alert**: cooldown per-nama-rule mencegah lebih dari satu alert per rule per
  periode cooldown.

## Access Log Sampling

Pada RPS tinggi, access logging per-request bisa jadi bottleneck sendiri (setiap
`logger.info` adalah format + write). Sampling menjaga sinyal tanpa biayanya.

`server.accessLogSampleRate` (default `1` — log setiap request, tanpa perubahan
perilaku). Set ke `N` untuk me-log 1-dari-N request yang selesai, deterministik via
counter request-id (stabil, bisa dikorelasikan). Response dengan status `>= 500`
selalu di-log terlepas dari sampling — error tidak pernah keluar dari jejak observability.
