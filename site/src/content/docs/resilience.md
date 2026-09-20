---
title: "Resilience (F2)"
description: "Circuit breaker, retries, health checks, fallbacks, and timeout budgets."
order: 5
section: "Features"
---

# Resilience

Circuit breaker, retries, health checks, fallbacks, and timeout budgets.

All 5 features in this group are **implemented and verified** — each has a full FSD + ERD spec pair and unit/integration coverage in the repo test suite.

## Circuit Breaker

Circuit breaker melindungi gateway dan upstream dari *cascading failure*: saat sebuah upstream
gagal terus-menerus, breaker membuka (*OPEN*) sehingga request berikutnya ditolak instan di
gateway tanpa menyentuh upstream yang sekarat. Setelah cooldown, breaker masuk *HALF_OPEN*
untuk menguji kembali koneksi dengan traffic terbatas, lalu kembali *CLOSED* bila pulih.

Implementasi mengikuti mesin state tiga-keadaan ala Martin Fowler, per-instance per-upstream,
murni in-memory, tanpa dependensi eksternal (`node:process.hrtime.bigint()` untuk pengukuran
waktu, `setTimeout` bukan library).

**Tujuan:**
- Menghentikan failure cascade sebelum menghabiskan socket pool gateway.
- Memberi upstream waktu pemulihan (default 60 detik cooldown).
- Memberikan observabilitas: success rate, failure rate, jumlah state change, waktu di state.

### How it works

1. `execute(fn)` dipanggil proxy handler per request upstream.
2. State `CLOSED` (fast-path): request langsung dieksekusi; sukses/gagal tetap dicatat
   ke sliding-window counter agar threshold tetap akurat tanpa biaya hrtime/logging.
3. Failure rate window melewati `failureThreshold` → state `OPEN` (breaker terbuka,
   cooldown timer `resetTimeout` dimulai).
4. Request saat `OPEN` langsung gagal cepat (`CircuitOpenError`) tanpa menyentuh
   upstream — proxy handler merutekannya ke fallback handler.
5. Cooldown habis → `HALF_OPEN`: satu canary request diizinkan. Sukses → kembali
   `CLOSED` (window reset); gagal → kembali `OPEN` dengan cooldown baru.


## Retry Manager

Retry-Manager mengeksekusi request upstream dengan mekanisme retry otomatis: kegagalan yang
sifatnya transien (502/503/504/408/429, `ECONNREFUSED`, timeout) dicoba ulang dengan
*exponential backoff + jitter* sampai batas attempt atau budget waktu habis. Tujuannya
menaikkan success rate tanpa membebani upstream yang bermasalah (*thundering herd*
dicegah oleh jitter) dan tanpa menambah latency tak terbatas (*retry budget*).

### How it works

1. `RetryManager.execute(fn, context, config?)` dipanggil oleh proxy pipeline untuk request
   yang layak di-retry.
2. **Filter metode** — hanya metode idempoten yang di-retry (default `GET, PUT, DELETE,
   HEAD, OPTIONS`). `POST` langsung dieksekusi sekali tanpa retry (bisa menduplikasi efek).
3. **Loop attempt** (`1..maxAttempts`, default 3):
   - Cek *retry budget*: `elapsedTime >= timeout` (default 30000 ms) → berhenti.
   - Cek circuit breaker (jika diisi di `context.circuitBreaker`): state `OPEN` → berhenti,
     tidak membuang attempt ke upstream yang sudah diputus.
   - Attempt > 1: hitung `delay = initialDelay * backoffMultiplier^(attempt-1)`, cap di
     `maxDelay` (5000 ms), bila `jitter: true` delay = `random() * delay` (*full jitter*),
     lalu `delay` dipotong agar tidak melebihi sisa budget, dan di-`sleep`.
4. **Keputusan retryable** — `shouldRetry()`: error yang ditandai retryable, `GatewayError`
   dengan status di `retryableStatuses`, atau pesan mengandung `timeout / econnrefused /
   econnreset / ehostunreach / enetunreach / unavailable`.
5. **Hasil** — `RetryResult<T>`: `value` atau `error` final, plus `attempts`, `totalTime`,
   `retried` (boolean) — tidak melempar exception ke pemanggil.
6. Statistik: `getStats()` → `activeRetries, totalRetries, successfulRetries, failedRetries,
   successRate`; `resetStats()` untuk reset counter.


## Health Checker

Health-Checker menjaga status kesehatan per-upstream (`healthy: boolean`) yang jadi input
keputusan routing, load balancer, dan circuit breaker. Tiga mode probe:

- **Active** — gateway secara periodik (default tiap 10 s) mengirim `GET {host}:{port}/health`
  dan menilai status code; tanpa traffic pun status tetap mutakhir.
- **Passive** — kesehatan disimpulkan dari trafik nyata: `recordPassiveCheck()` dipanggil
  proxy-handler setelah tiap request upstream (sukses/gagal + response time). Tanpa probing
  ekstra — cocok untuk upstream yang mahal di-probe.
- **Hybrid** — active dicoba lebih dulu; bila gagal, fallback ke passive (menghindari
  false-negative saat endpoint health sibuk).

Tujuan: upstream yang mati dikeluarkan dari rotasi dalam hitungan detik-detik interval,
bukan hanya saat request client gagal.

### How it works

1. `start(upstreams)` dijalankan ProxyHandler saat boot; tiap upstream dengan
   `healthCheck.enabled` didaftarkan + satu `setInterval` per upstream (interval default
   10 s), plus satu pemeriksaan awal segera.
2. Tiap probe menghasilkan `HealthCheckResult { upstreamId, status, responseTime, timestamp,
   error?, checkType }`; active check: `statusCode === expectedStatus` (default 200) →
   HEALTHY; timeout (default 5 s) atau error jaringan → UNHEALTHY. Response body
   di-*drain* agar socket tidak menggantung.
3. `performTCPCheck()` tersedia sebagai probe level-TCP (koneksi socket saja, tanpa HTTP).
4. `processResult()` memperbarui `HealthCheckStats`: counter total/sukses/gagal,
   rata-rata response time bergerak, `consecutiveFailures` / `consecutiveSuccesses`.
5. **Threshold hysteresis**: UNHEALTHY setelah `unhealthyThreshold` (3) kegagalan
   berturut-turut; HEALTHY kembali setelah `healthyThreshold` (2) sukses berturut-turut —
   mencegah flapping akibat satu kegagalan sesaat.
6. **Grace period** (default 5 s): upstream yang baru ditambahkan dianggap HEALTHY selama
   grace period, memberi waktu warm-up.
7. Perubahan status ditulis ke `upstream.healthy` dan dilog
   `Upstream <id> health status changed to <STATUS>`.
8. `getHealthReport()` menyusun laporan gateway-level: `healthy | degraded | unhealthy`
   (degraded = sebagian upstream sakit), plus per-upstream `lastCheck, responseTime,
   consecutiveFailures, errorRate`.
9. `stop()` membersihkan semua interval; `addUpstream()`/`removeUpstream()` untuk update
   dinamis tanpa restart.


## Fallback Handler

Fallback-Handler menyajikan response yang berguna ke client saat upstream tidak dapat
melayani (breaker OPEN, upstream UNHEALTHY, semua retry habis). Alih-alih connection error
mentah, client menerima response JSON terstruktur — atau lebih baik lagi, response cache
yang masih layak pakai (*stale serving*).

Tiga tingkat fallback, dicoba berurutan:

1. **Static fallback** — response yang didaftarkan eksplisit per route atau per upstream
   (`setStaticFallback(key, response)`), mis. halaman maintenance atau data default.
2. **Stale cached response** — response sukses sebelumnya yang di-cache via
   `cacheResponse()` disajikan ulang dengan `Warning: 110 - "Response is Stale"` +
   `x-served-from-cache: true`, selama umurnya ≤ `ttl + maxStaleAge` (default 5 menit stale).
3. **Default template** — JSON error sesuai status code (503 `SERVICE_UNAVAILABLE`,
   502 `BAD_GATEWAY`, 504 `GATEWAY_TIMEOUT`) dengan header `x-fallback-response: true`.

Tujuan: degradasi yang anggun (*graceful degradation*) — client selalu menerima response
yang bisa di-parse, bukan reset koneksi.

### How it works

1. `getFallback(context)` dipanggil proxy pipeline saat request upstream gagal; context
   berisi `route`, `upstreamId`, `error`, `requestId`.
2. **Tingkat 1**: bila `enableStaticFallback` dan ada static fallback terdaftar untuk
   `context.route`, lalu untuk `context.upstreamId` → kembalikan apa adanya.
3. **Tingkat 2**: bila `enableStaleFallback` — lookup cache key `route:upstreamId`
   (atau `route` saja); bila ada dan `age <= ttl + maxStaleAge` → kembalikan response
   cache + header stale warning; counter `staleFallbackCount++`.
4. **Tingkat 3**: `getDefaultFallback(context)` menentukan status code dari error:
   `GatewayError` → `error.statusCode`; pesan mengandung `timeout` → 504, `circuit`/
   `breaker`/`unavailable` → 503; sisanya default 503. Body dari template status terkait,
   atau template generik `SERVICE_ERROR` berisi `requestId`.
5. Body selalu `Buffer` UTF-8 dengan `content-type: application/json`.
6. `cleanup()` menghapus cache entry yang melewati `ttl + maxStaleAge`; `destroy()`
   mengosongkan semua map; `getStats()` melaporkan `totalFallbacks, staleFallbacks,
   staticFallbackCount, cachedResponseCount`.


## Timeout Manager

Timeout-Manager membatasi durasi setiap jenis operasi di gateway agar tidak ada request
atau plugin yang menggantung tanpa batas. Satu komponen, lima budget:

- `connection` (5 s) — membuka koneksi ke upstream.
- `request` (30 s) — total waktu request end-to-end termasuk retry.
- `upstream` (20 s) — menunggu response upstream.
- `plugin` (1 s) — eksekusi satu plugin di chain.
- `idle` (60 s) — koneksi idle di pool.

Tujuan: latency p99 gateway terikat (request gagal cepat, bukan menggantung), resource
(socket, handle timer) dibebaskan tepat waktu, dan error yang dihasilkan selalu
`TimeoutError` terstruktur dengan tipe + status HTTP 504 — siap dipetakan ke fallback.

### How it works

1. **`execute(fn, type, context?, customTimeout?)`** — bungkus promise `fn` dengan
   `setTimeout(timeout)`. Sebelum timeout: timer di-clear, handle dihapus dari
   `activeTimeouts`, hasil dikembalikan. Saat timeout: `handle.triggered = true`,
   `AbortController.abort()` membatalkan operasi, counter naik, reject dengan
   `TimeoutError` (`timeoutType`, `timeout`, code `CONNECTION_TIMEOUT` / `REQUEST_TIMEOUT`
   / `UPSTREAM_TIMEOUT` / `PLUGIN_TIMEOUT`, status 504, flag retryable — plugin timeout
   tidak retryable).
2. **`createHandle(type, context?, customTimeout?)`** — untuk operasi yang tidak berbasis
   promise: mengembalikan `{ handleId, signal, cancel() }`; pemanggil meng-attach
   `signal` ke operasi (mis. `http.request({ signal })`) dan menerima abort saat timeout.
3. **`cancel(handleId)` / `cancelAll()`** — clear timer yang belum triggered (pembebasan
   manual/shutdown); timer yang sudah triggered dibiarkan (sudah dihitung).
4. **Statistik** — `getStats()` → `totalTimeouts`, `activeTimeouts`, `timeoutsByType`
   (per lima tipe); `hasTimedOut(handleId)`, `getElapsed(handleId)` untuk introspeksi.
5. **`destroy()`** — `cancelAll()` + clear map; dipanggil saat shutdown.
6. Handle ID unik: `timeout-<epoch>-<random>`; setiap handle tersimpan di
   `Map<handleId, TimeoutHandle>` selama aktif.
