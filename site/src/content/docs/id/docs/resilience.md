---
title: "Resilience"
description: "Circuit breaker, retry, health check, fallback, dan timeout budget."
order: 5
section: "Features"
track: "reference"
---

Semua 5 fitur di grup ini sudah **terimplementasi dan terverifikasi** — masing-masing punya pasangan spesifikasi FSD + ERD lengkap dan cakupan unit/integration di test suite repo.

## Circuit Breaker

Circuit breaker melindungi gateway dan upstream-nya dari *cascading failure*: ketika sebuah upstream
terus gagal, breaker terbuka (*OPEN*) sehingga request berikutnya langsung ditolak di
gateway tanpa menyentuh upstream yang sekarat. Setelah masa cooldown, breaker pindah ke *HALF_OPEN*
untuk menyelidiki ulang koneksi dengan trafik terbatas, lalu kembali ke *CLOSED* setelah pulih.

Implementasinya mengikuti mesin tiga-state ala Martin Fowler, satu instance per upstream,
murni in-memory, tanpa dependensi eksternal (`node:process.hrtime.bigint()` untuk pengukuran
waktu, `setTimeout` alih-alih library).

**Tujuan:**
- Menghentikan kaskade kegagalan sebelum menghabiskan socket pool gateway.
- Memberi upstream waktu untuk pulih (cooldown default 60 detik).
- Menyediakan observabilitas: success rate, failure rate, jumlah pergantian state, waktu yang dihabiskan per state.

### Cara kerjanya

1. `execute(fn)` dipanggil oleh proxy handler untuk setiap request upstream.
2. State `CLOSED` (fast-path): request langsung dieksekusi; sukses/gagal tetap
   dicatat ke penghitung sliding-window supaya threshold tetap akurat tanpa biaya hrtime/logging.
3. Failure rate window melebihi `failureThreshold` → state `OPEN` (breaker terbuka,
   timer cooldown `resetTimeout` mulai berjalan).
4. Request selama `OPEN` gagal cepat (`CircuitOpenError`) tanpa menyentuh
   upstream — proxy handler mengarahkannya ke fallback handler.
5. Cooldown habis → `HALF_OPEN`: satu request canary diizinkan. Sukses → kembali ke
   `CLOSED` (window di-reset); gagal → kembali ke `OPEN` dengan cooldown baru.


## Retry Manager

Retry-Manager mengeksekusi request upstream dengan retry otomatis: kegagalan transien
(502/503/504/408/429, `ECONNREFUSED`, timeout) dicoba ulang dengan
*exponential backoff + jitter* sampai batas percobaan atau budget waktu habis. Tujuannya
menaikkan success rate tanpa membebani upstream yang sedang kesulitan (*thundering herd*
dicegah oleh jitter) dan tanpa latensi tak terbatas (*retry budget*).

### Cara kerjanya

1. `RetryManager.execute(fn, context, config?)` dipanggil oleh proxy pipeline untuk request
   yang memenuhi syarat retry.
2. **Filter method** — hanya method idempoten yang di-retry (default `GET, PUT, DELETE,
   HEAD, OPTIONS`). `POST` dieksekusi tepat sekali tanpa retry (retry bisa menduplikasi efek).
3. **Loop percobaan** (`1..maxAttempts`, default 3):
   - Cek *retry budget*: `elapsedTime >= timeout` (default 30000 ms) → berhenti.
   - Cek circuit breaker (kalau disediakan di `context.circuitBreaker`): state `OPEN` → berhenti,
     tidak ada percobaan yang terbuang untuk upstream yang sudah dinyatakan down.
   - Percobaan > 1: hitung `delay = initialDelay * backoffMultiplier^(attempt-1)`, dibatasi
     `maxDelay` (5000 ms); kalau `jitter: true`, delay = `random() * delay` (*full jitter*);
     delay lalu di-clamp supaya tidak melebihi sisa budget, kemudian `sleep`.
4. **Keputusan retryable** — `shouldRetry()`: error yang ditandai retryable, `GatewayError`
   dengan status di `retryableStatuses`, atau pesan yang mengandung `timeout / econnrefused /
   econnreset / ehostunreach / enetunreach / unavailable`.
5. **Hasil** — `RetryResult<T>`: `value` atau `error` terakhir, plus `attempts`, `totalTime`,
   `retried` (boolean) — tidak ada exception yang dilempar ke caller.
6. Statistik: `getStats()` → `activeRetries, totalRetries, successfulRetries, failedRetries,
   successRate`; `resetStats()` me-reset penghitung.


## Health Checker

Health-Checker memelihara status kesehatan per upstream (`healthy: boolean`) yang memberi makan
keputusan routing, load balancer, dan circuit breaker. Tiga mode probe:

- **Active** — gateway secara berkala (default tiap 10 s) mengirim `GET {host}:{port}/health`
  dan mengevaluasi status code-nya; status tetap terkini meski tanpa trafik.
- **Passive** — kesehatan disimpulkan dari trafik nyata: `recordPassiveCheck()` dipanggil
  oleh proxy handler setelah setiap request upstream (sukses/gagal + response time). Tanpa
  probing tambahan — cocok untuk upstream yang mahal untuk di-probe.
- **Hybrid** — active dicoba dulu; kalau gagal, mundur ke passive (menghindari
  false negative saat endpoint health sedang sibuk).

Tujuan: upstream yang mati ditarik dari rotasi dalam beberapa interval probe,
bukan cuma saat request client gagal.

### Cara kerjanya

1. `start(upstreams)` dijalankan oleh ProxyHandler saat boot; setiap upstream dengan
   `healthCheck.enabled` didaftarkan + satu `setInterval` per upstream (interval default
   10 s), ditambah satu pengecekan awal langsung.
2. Setiap probe menghasilkan `HealthCheckResult { upstreamId, status, responseTime, timestamp,
   error?, checkType }`; active check: `statusCode === expectedStatus` (default 200) →
   HEALTHY; timeout (default 5 s) atau error jaringan → UNHEALTHY. Body response
   di-*drain* supaya socket tidak menggantung.
3. `performTCPCheck()` tersedia sebagai probe level TCP (koneksi socket saja, tanpa HTTP).
4. `processResult()` memperbarui `HealthCheckStats`: penghitung total/sukses/gagal,
   response time moving-average, `consecutiveFailures` / `consecutiveSuccesses`.
5. **Histeresis threshold**: UNHEALTHY setelah `unhealthyThreshold` (3) kegagalan
   beruntun; HEALTHY lagi setelah `healthyThreshold` (2) keberhasilan beruntun —
   mencegah flapping dari satu kegagalan sesaat.
6. **Grace period** (default 5 s): upstream yang baru ditambahkan dianggap HEALTHY selama
   grace period, memberi mereka waktu pemanasan.
7. Perubahan state ditulis ke `upstream.healthy` dan dicatat sebagai
   `Upstream <id> health status changed to <STATUS>`.
8. `getHealthReport()` membangun laporan level gateway: `healthy | degraded | unhealthy`
   (degraded = sebagian upstream sakit), plus per-upstream `lastCheck, responseTime,
   consecutiveFailures, errorRate`.
9. `stop()` membersihkan semua interval; `addUpstream()`/`removeUpstream()` untuk
   pembaruan dinamis tanpa restart.


## Fallback Handler

Fallback-Handler menyajikan response yang berguna ke client ketika upstream tidak bisa
melayani (breaker OPEN, upstream UNHEALTHY, semua retry habis). Alih-alih error koneksi
mentah, client menerima response JSON terstruktur — atau lebih baik lagi, response dari cache
yang masih layak disajikan (*stale serving*).

Tiga tingkat fallback, dicoba berurutan:

1. **Static fallback** — response yang didaftarkan eksplisit per rute atau per upstream
   (`setStaticFallback(key, response)`), mis. halaman maintenance atau data default.
2. **Stale cached response** — response sukses sebelumnya yang di-cache via
   `cacheResponse()` disajikan ulang dengan `Warning: 110 - "Response is Stale"` +
   `x-served-from-cache: true`, selama umurnya ≤ `ttl + maxStaleAge` (default 5 menit stale).
3. **Template default** — error JSON yang sesuai status code (503 `SERVICE_UNAVAILABLE`,
   502 `BAD_GATEWAY`, 504 `GATEWAY_TIMEOUT`) dengan header `x-fallback-response: true`.

Tujuan: graceful degradation — client selalu menerima response yang bisa di-parse,
tidak pernah connection reset.

### Cara kerjanya

1. `getFallback(context)` dipanggil oleh proxy pipeline saat request upstream gagal; context
   berisi `route`, `upstreamId`, `error`, `requestId`.
2. **Tingkat 1**: kalau `enableStaticFallback` dan ada static fallback terdaftar untuk
   `context.route`, lalu untuk `context.upstreamId` → kembalikan apa adanya.
3. **Tingkat 2**: kalau `enableStaleFallback` — cari cache key `route:upstreamId`
   (atau `route` saja); kalau ada dan `age <= ttl + maxStaleAge` → kembalikan response
   dari cache + header peringatan stale; `staleFallbackCount++`.
4. **Tingkat 3**: `getDefaultFallback(context)` menurunkan status code dari error:
   `GatewayError` → `error.statusCode`; pesan mengandung `timeout` → 504, `circuit`/
   `breaker`/`unavailable` → 503; selain itu default 503. Body berasal dari template status yang cocok,
   atau template generik `SERVICE_ERROR` yang berisi `requestId`.
5. Body selalu `Buffer` UTF-8 dengan `content-type: application/json`.
6. `cleanup()` menghapus entri cache yang melewati `ttl + maxStaleAge`; `destroy()`
   mengosongkan semua map; `getStats()` melaporkan `totalFallbacks, staleFallbacks,
   staticFallbackCount, cachedResponseCount`.


## Timeout Manager

Timeout-Manager membatasi durasi setiap jenis operasi di gateway supaya tidak ada request
atau plugin yang menggantung tanpa batas. Satu komponen, lima budget:

- `connection` (5 s) — membuka koneksi ke upstream.
- `request` (30 s) — total waktu request end-to-end termasuk retry.
- `upstream` (20 s) — menunggu response upstream.
- `plugin` (1 s) — mengeksekusi satu plugin dalam chain.
- `idle` (60 s) — koneksi pooled yang idle.

Tujuan: latensi p99 gateway tetap terbatas (request gagal cepat alih-alih menggantung), resource
(socket, timer handle) dibebaskan tepat waktu, dan error yang dihasilkan selalu berupa
`TimeoutError` terstruktur dengan tipe + HTTP status 504 — siap dipetakan ke fallback.

### Cara kerjanya

1. **`execute(fn, type, context?, customTimeout?)`** — membungkus promise `fn` dengan
   `setTimeout(timeout)`. Sebelum timeout: timer dibersihkan, handle dihapus dari
   `activeTimeouts`, hasil dikembalikan. Saat timeout: `handle.triggered = true`,
   `AbortController.abort()` membatalkan operasi, penghitung bertambah, reject dengan
   `TimeoutError` (`timeoutType`, `timeout`, code `CONNECTION_TIMEOUT` / `REQUEST_TIMEOUT`
   / `UPSTREAM_TIMEOUT` / `PLUGIN_TIMEOUT`, status 504, flag retryable — timeout plugin
   tidak retryable).
2. **`createHandle(type, context?, customTimeout?)`** — untuk operasi yang tidak berbasis
   promise: mengembalikan `{ handleId, signal, cancel() }`; caller memasang
   `signal` ke operasi (mis. `http.request({ signal })`) dan menerima abort saat timeout.
3. **`cancel(handleId)` / `cancelAll()`** — membersihkan timer yang belum terpicu (pelepasan
   manual/shutdown); timer yang sudah terpicu dibiarkan (sudah tercatat).
4. **Statistik** — `getStats()` → `totalTimeouts`, `activeTimeouts`, `timeoutsByType`
   (per lima tipe); `hasTimedOut(handleId)`, `getElapsed(handleId)` untuk introspeksi.
5. **`destroy()`** — `cancelAll()` + bersihkan map; dipanggil saat shutdown.
6. Handle ID unik: `timeout-<epoch>-<random>`; setiap handle disimpan di
   `Map<handleId, TimeoutHandle>` selama aktif.
