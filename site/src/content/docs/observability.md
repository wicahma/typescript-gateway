---
title: "Observability (F5)"
description: "Lock-free metrics, structured logging, live dashboard, and in-process profiling."
order: 8
section: "Features"
---

# Observability

Lock-free metrics, structured logging, live dashboard, and in-process profiling.

All 4 features in this group are **implemented and verified** — each has a full FSD + ERD spec pair and unit/integration coverage in the repo test suite.

## CPU Memory Profiler

Toolkit profiling in-process untuk diagnosis CPU dan memori gateway — bawaan Node.js
(`inspector`, `v8`, `process`), tanpa dependensi eksternal:

- `src/profiling/cpu-profiler.ts` (453 LOC) — CPU sampling via V8 Inspector
  (`Profiler.start/stop`), analisis hot function, ekspor flame graph format
  collapsed-stack, dan mode sampling ringan berbasis stack capture.
- `src/profiling/memory-profiler.ts` (408 LOC) — heap snapshot (`v8.writeHeapSnapshot`),
  perbandingan snapshot untuk deteksi leak, tracking alokasi, monitor GC.
- `src/core/memory-optimizer.ts` (396 LOC) — monitoring memori periodik, analisis
  pertumbuhan heap, deteksi leak otomatis, rekomendasi flag GC, laporan memori.
- `src/core/v8-optimizations.ts` (338 LOC) — analisis shape/hidden class, deteksi
  polimorfisme, benchmark fungsi, helper monomorphic handler.

Tujuan: saat latensi memburuk atau memori tumbuh, operator dapat mengambil profil
dan snapshot tanpa memasang tooling eksternal atau me-restart proses.

### How it works

- **CPU (V8 Inspector)**: `CPUProfiler.startProfiling(duration?)` membuka `Session`,
  `Profiler.enable` + `Profiler.start` dengan `samplingInterval` (default 1000 µs).
  `stopProfiling()` memproses node + samples + timeDeltas menjadi `ProfileResult`
  (selfTime/totalTime per node). `analyzeProfile()` mengurutkan top-20 hot function
  dengan persentase terhadap total CPU time. `generateFlameGraph()` menulis format
  collapsed stack (`func (file:line);... count`) siap untuk flamegraph.pl.
- **CPU sampling ringan**: `startSampling(interval)` menangkap stack via
  `new Error().stack` (regex parse frame atas) — overhead rendah, akurasi lebih kasar;
  berhenti otomatis pada `maxSamples` (default 10.000).
- **Memori**: `MemoryProfiler.takeSnapshot()` menulis file `.heapsnapshot` ke
  `heapdumps/`, mencatat `{ id, timestamp, path, size, heapUsed }` ke daftar
  in-memory. `compareSnapshots()` menghitung `heapGrowth` dan `growthRate` (MB/jam)
  serta menandai leak bila pertumbuhan > 10 MB. `analyzeHeapGrowth(interval, duration)`
  (MemoryOptimizer) menyampling `process.memoryUsage()` berkala dan menyimpulkan
  `isLeaking` pada growth rate > 10 MB/jam, termasuk cek external/arrayBuffers.
- **Monitor & rekomendasi**: `MemoryOptimizer.startMonitoring(interval)` menyimpan
  history 1000 sampel, menjalankan `detectMemoryLeaks()` periodik (threshold 10 MB/jam,
  level `suspected`/`confirmed`), `getRecommendations()` memberi saran berbasis
  utilisasi heap (80%/90%), external memory, dan GC pause rata-rata.
  `forceGC()` tersedia bila Node dijalankan dengan `--expose-gc`.
- **V8 optimizations**: `analyzeObjectShape()` memeriksa konsistensi urutan properti
  (hidden class stability); `PolymorphismDetector` memperingatkan call-site dengan
  > 4 tipe; `benchmark()` mengukur dampak optimisasi (warmup 100 iterasi).

### Configuration

| Opsi | Default | Lokasi |
|---|---|---|
| `samplingInterval` (CPU) | 1000 µs | `ProfilerConfig` |
| `maxSamples` | 10000 | `ProfilerConfig` |
| `includeNative` | false | `ProfilerConfig` |
| Sampling interval ringan | 100 ms | `startSampling(interval)` |
| `snapshotPath` | `<cwd>/heapdumps` | `MemoryProfilerConfig` |
| `retentionDays` | 7 | pembersihan snapshot lama |
| `autoSnapshot` / `autoSnapshotInterval` | false / 3600000 ms | snapshot otomatis |
| Threshold leak | 10 MB/jam | `analyzeHeapGrowth` / `detectMemoryLeaks` |
| Monitoring interval | 10000 ms | `MemoryOptimizer.startMonitoring` |

Tidak ada field `gateway.config.json` — profiler diaktifkan secara programatik
(on-demand diagnosis), bukan selalu-on.

### Edge cases

- **Profiling ganda**: `startProfiling()` saat sesi aktif melempar
  `Error('Profiling already in progress')`; `stopProfiling()` tanpa sesi melempar
  `Error('No profiling session active')`.
- **Snapshot file**: `writeHeapSnapshot` sinkron dan memblokir event loop beberapa
  detik pada heap besar — gunakan pada diagnosis, bukan berkala di produksi sibuk.
- **Perbandingan snapshot**: analisis leak per-tipe masih disederhanakan
  (deteksi berbasis total growth, bukan parsing snapshot) — diakui jujur di kode
  sebagai simplified implementation.
- **GC monitor**: `GCMonitorImpl.start()` belum memasang `PerformanceObserver` —
  event list kosong sampai implementasi dilengkapi (dokumentasi kode menyatakan ini).
- **`forceGC()` tanpa `--expose-gc`**: warning console, tidak crash; statistik GC
  tidak tercatat.
- **Retensi snapshot**: `cleanupSnapshots()` menghapus file > `retentionDays`;
  referensi in-memory dibatasi 10 terakhir (MemoryOptimizer).


## Metrics Histogram

Kolektor metrik latensi dan counter untuk gateway, dirancang agar overhead pengukuran
tidak terasa dibanding latency request itu sendiri. Tiga lapisan:

1. `MetricsCollector` (`src/utils/metrics.ts`) — counter lock-free + histogram ring
   buffer 10.000 sampel, singleton `metrics`.
2. `MetricsAggregator` (`src/core/metrics-aggregator.ts`) — histogram berbasis
   `Int32Array(310)` dengan operasi `Atomics.*` (lock-free, siap dipakai lintas
   worker via `SharedArrayBuffer`), plus sliding window 60 detik.
3. `AdvancedMetrics` (`src/core/advanced-metrics.ts`) — metrik domain: per-route,
   per-upstream, transformasi, kompresi, WebSocket, error rate (jendela 1/5/15 menit),
   statistik retry, timeout, dan circuit breaker.

Tujuan: p50/p95/p99 latensi, RPS, error rate, dan throughput tersedia kapan pun
(`GET /metrics`) tanpa garbage-collection pressure berarti.

### How it works

- **Ring buffer histogram** (`LatencyHistogram`, default 10.000 sampel): setiap
  `record(latencyMs)` menulis ke slot `index % size`. Ketika buffer penuh, sampel
  lama tertimpa (fixed memory, tanpa pertumbuhan). Percentile dihitung dengan
  mengurutkan salinan sampel saat `snapshot()` dipanggil — O(n log n) hanya pada
  jalur baca, bukan jalur tulis.
- **Histogram atomik** (`MetricsAggregator`): 100 bucket distribusi logaritmik per
  dimensi (latensi 1–100 ms, request/response size 100 B–10 KB), ditambah 10 slot
  counter. Increment memakai `Atomics.add` sehingga aman dibaca ditulis konkuren
  dan dapat dibagikan ke worker_threads lewat `getSharedBuffer()`.
- **Sliding window**: tiap record juga masuk `WindowEntry[]` (maks 10.000 entri,
  usia maks 60 detik) untuk persentil yang lebih akurat pada data terbaru
  (`getWindowSnapshot()`).
- **Metrik domain** (`AdvancedMetrics`): agregasi inkremental (count/total/avg/min/max)
  per route dan upstream; error rate dihitung dari riwayat timestamp yang dibersihkan
  terhadap jendela terbesar (900 detik).
- Semua entitas metrik in-memory — mati bersama proses. Lihat
  FSD dan
  ERD.

### Configuration

| Opsi | Default | Lokasi |
|---|---|---|
| Ukuran histogram ring buffer | `10000` sampel | `new MetricsCollector(histogramSize)` |
| Shared memory aggregator | `false` | `new MetricsAggregator({ useSharedMemory })` |
| Ukuran sliding window | `10000` entri / `60000` ms | `new MetricsAggregator({ windowSize, windowDuration })` |
| Jendela error rate | `[60, 300, 900]` detik | `AdvancedMetricsConfig.timeWindows` |
| Reporting periodik | `60000` ms (log snapshot metrik) | `Gateway.setupMetricsReporting()` |
| Endpoint snapshot | `GET /metrics` | route sistem, registered di `src/index.ts` |

Tidak ada field khusus di `gateway.config.json` untuk fitur ini — semuanya
di-instantiate dengan default di kode (zero-config by design).

### Edge cases

- **Latensi di luar rentang bucket**: nilai di-clamp ke rentang histogram (mis. 1–100 ms)
  sebelum mapping bucket — tidak pernah index out-of-bounds.
- **Snapshot saat buffer belum penuh**: hanya slot terisi yang dihitung
  (`filled` flag); percentile/avg tetap benar sejak request pertama.
- **`totalOriginalSize = 0` pada kompresi**: rasio dihitung dari akumulasi total,
  bukan per-event, sehingga tidak ada pembagian dengan nol pada event pertama.
- **Reset konkuren**: `Atomics.store(…, 0)` untuk seluruh buffer; sliding window
  dibuang sekaligus. Snapshot yang berjalan bersamaan bisa melihat setengah-reset —
  diterima karena snapshot bersifat best-effort, bukan transaksional.
- **Riwayat error rate tumbuh**: dibersihkan tiap `recordErrorRate` terhadap jendela
  terbesar (900 s); distribusi timeout dibatasi 10.000 durasi terakhir.


## Native Structured Logger

Logger JSON terstruktur bawaan (`src/utils/logger.ts`, 211 LOC) yang **menggantikan
pino** sebagai bagian dari prinsip zero-dependency gateway. Tujuan: logging
sinkron tanpa alokasi pipeline yang tidak perlu — setiap baris adalah
`JSON.stringify(payload) + '\n'` yang langsung ditulis ke `process.stdout.write()`
(pilihan `appendFileSync` bila `destination` file diset). Format baris kompatibel
dengan konsumsi log standar: satu JSON object per line (NDJSON), field
`level`, `time` (ISO-8601), `pid`, `hostname`, `msg`.

### How it works

- **Enam level**: `TRACE(10) DEBUG(20) INFO(30) WARN(40) ERROR(50) FATAL(60)`.
  `write()` early-return bila bobot level event < bobot level logger aktif —
  pemanggilan `logger.debug()` saat level `info` hampir gratis (satu perbandingan angka).
- **Tiga mode payload** di `FastNativeLogger.write()`:
  1. string → `{ level, time, pid, hostname, ...bindings, msg }`;
  2. object → spread sebagai field top-level + `msg` opsional;
  3. lainnya → dibungkus field `data`.
- **Child loggers**: `child(bindings)` membuat instance baru dengan bindings
  ter-merge — dipakai `StructuredLogger.component(name)` untuk logger per komponen
  (`componentLoggers` Map, cache), `withCorrelation(id)` untuk request tracing,
  dan `withContext(ctx)`.
- **`StructuredLogger`** (wrapper berfitur): `logRequest`, `logResponse`
  (status ≥ 500 → `error`, ≥ 400 → `warn`, selainnya `info`), `logSlowRequest`
  (threshold default 100 ms), `logError` dengan sampling rate, `updateConfig`
  hot-update (level per komponen direset bersama cache child logger).
- **`createRequestLogger()`**: helper stateless untuk request/response/error logging.
- Level default dibaca dari `LOG_LEVEL` env (fallback `info`).

### Configuration

| Opsi | Default | Sumber |
|---|---|---|
| `level` | `info` / `LOG_LEVEL` env | `LoggerConfig.level` |
| `destination` | tidak diset → stdout | `LoggerConfig.destination` (path file, `appendFileSync`) |
| `pretty` | `false` | ada di interface; implementasi saat ini selalu NDJSON |
| `slowRequestThreshold` | `100` ms | `StructuredLogger` |
| `errorSampling` | `1.0` | proporsi error yang tercatat |
| `componentLevels` | `{}` | level override per nama komponen |
| `enableCorrelationId` | `true` | binding `correlationId` pada child logger |

### Edge cases

- **Gagal tulis ke file destination**: `appendFileSync` dibungkus try/catch —
  fallback ke `process.stdout.write(line)`; log tidak pernah hilang, proses tidak crash.
- **Level tidak dikenal** di `LEVEL_WEIGHT`: fallback bobot 30 (info).
- **Payload bukan object/string**: dibungkus `{ data: value }` — tidak pernah
  `JSON.stringify(undefined)` yang menghasilkan baris kosong.
- **Error object**: `logError` mengekstrak `{ name, message, stack }` secara
  eksplisit; `JSON.stringify(err)` mentah akan membuang stack.
- **Sinkron I/O**: `appendFileSync` memblokir event loop — oleh karena itu default
  adalah stdout (async pipe), file destination hanya untuk penggunaan sengaja.


## Performance Dashboard

Server HTTP monitoring terpisah (`src/monitoring/performance-dashboard.ts`, 420 LOC)
yang menyajikan metrik performa gateway secara real-time (SSE) dan historis, plus
evaluasi aturan alert (`src/monitoring/performance-alerts.ts`, 283 LOC). Tujuan:
operator bisa melihat p50/p95/p99, throughput, error rate, dan memory usage tanpa
menyentuh endpoint gateway utama — dashboard berjalan di port sendiri.

### How it works

- **`PerformanceDashboard.start(port)`** menjalankan `http.createServer` tersendiri
  dengan CORS terbuka (`GET, OPTIONS`) dan routing manual ke 6 endpoint `/api/performance/*`.
- **Real-time**: `GET /api/performance/realtime` membuka stream SSE
  (`text/event-stream`). `EventStream` (EventEmitter) menyimpan daftar `ServerResponse`
  klien, mem-broadcast event `metrics` / `worker` / `alert` sebagai
  `event: <name>\ndata: <json>\n\n`, dan membersihkan klien yang `destroyed`.
- **History**: `updateMetrics(point)` dipanggil periodik (interval 1 s saat server
  berjalan) dan menyimpan `MetricPoint` ke ring buffer **`metricsHistory`** — maks
  3.600 titik (1 jam pada interval 1 detik), FIFO `shift()`. Ring buffer ini adalah
  bentuk `METRIC_SAMPLE` untuk fitur ini: **TRANSIENT**, tidak pernah ditulis ke disk.
- **Query historis**: `getHistoricalMetrics({from,to})` memfilter titik berdasarkan
  window dan menghitung agregat (`avgLatencyP99`, `maxLatencyP99`, `avgThroughput`,
  total).
- **Alerting**: `PerformanceAlerter.checkAlerts(metrics)` mengevaluasi 7 aturan
  bawaan + aturan kustom dengan cooldown per aturan (default 60 s) dan mengirim
  notifikasi via handler opsional (fallback `console.warn`). Alert dibroadcast
  ke SSE via `dashboard.addAlert()`.
- **Per-worker / per-route / per-upstream**: Map `workerMetrics`, `routeMetrics`,
  `upstreamMetrics` di-update lewat method `update*Metric()` — sumber datanya
  Metrics-Histogram.

### Configuration

| Opsi | Default | Catatan |
|---|---|---|
| Port dashboard | wajib argumen `start(port)` | proses HTTP terpisah dari gateway |
| Interval update | 1000 ms | `startMetricsUpdate()` |
| Retensi history | 3.600 titik (~1 jam) | `metricsHistory` FIFO |
| Retensi alert | 100 alert terakhir / 1 jam (alerter) | FIFO + filter umur |
| Cooldown alert | 60000 ms | `AlertConfig.defaultCooldown` |
| Aturan bawaan | 7 aturan | lihat tabel di bawah |

Aturan bawaan `PerformanceAlerter`:

| Aturan | Kondisi | Severity | Cooldown |
|---|---|---|---|
| `latency-threshold` | p99 > 10 ms | critical | 60 s |
| `rps-drop` | penurunan > 20% vs sampel sebelumnya | warning | 60 s |
| `memory-leak` | pertumbuhan > 10 MB/jam | warning | 5 menit |
| `gc-pause` | p99 pause > 100 ms | warning | 60 s |
| `error-rate-spike` | error rate > 5% | critical | 60 s |
| `circuit-breaker-open` | breaker terbuka | warning | 2 menit |
| `connection-pool-exhaustion` | utilisasi pool > 90% | warning | 60 s |

### Edge cases

- **Data bawaan masih sampel acak**: `startMetricsUpdate()` saat ini memproduksi
  `MetricPoint` sintetis (`Math.random()`) — wiring ke metrik nyata belum
  terhubung di `Gateway`. Endpoint dan pipeline broadcast sudah teruji
  (`tests/unit/phase9/performance-dashboard.test.ts`, 8 it pass); koneksi data
  nyata adalah langkah integrasi berikutnya.
- **Klien SSE terputus**: handler `res.on('close')` menghapus klien dari daftar;
  `broadcast` melewati klien `destroyed`.
- **Range query di luar retensi**: `from` lebih tua dari 1 jam menghasilkan array
  kosong — tidak ada error; retensi memang terbatas 1 jam.
- **Aturan alert melempar exception**: `checkAlerts` membungkus evaluasi per aturan
  dalam try/catch dan mencatat ke console — aturan buruk tidak menghentikan aturan lain.
- **Alert spam**: cooldown per nama aturan mencegah >1 alert per aturan per
  periode cooldown.
