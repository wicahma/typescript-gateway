---
title: "Resilience"
description: "Circuit breaker, retries, health checks, fallbacks, dan timeout budgets."
---

Setiap fitur di grup ini sudah **terimplementasi dan terverifikasi**, masing-masing dengan cakupan unit dan integration test di test suite repo.

## Apa yang Dilakukannya (What it does)

Subsistem resilience melindungi gateway dan upstream dari kegagalan beruntun (cascading failure), ketidakstabilan jaringan, dan degradasi latensi.

### Circuit Breaker

Circuit breaker melindungi gateway dan upstream dari kegagalan beruntun: saat upstream terus menerus gagal, breaker membuka (*OPEN*) sehingga request berikutnya langsung ditolak cepat di level gateway tanpa membebani backend yang bermasalah. Setelah masa jeda (cooldown), breaker berpindah ke *HALF_OPEN* untuk menguji coba koneksi dengan trafik terbatas, lalu kembali ke *CLOSED* setelah pulih.

- **Status CLOSED (jalur cepat)**: Request dieksekusi normal; metrik dicatat dalam sliding-window counter.
- **Status OPEN**: Terpicu jika tingkat kegagalan melampaui `failureThreshold`. Timer jeda `resetTimeout` dimulai. Request langsung gagal dengan `CircuitOpenError` dan dialihkan ke fallback.
- **Status HALF_OPEN**: Masa jeda berakhir dan request canary diizinkan. Pengujian berhasil menutup kembali breaker; kegagalan membukanya kembali.

### Retry Manager

Retry Manager mengeksekusi request upstream dengan pengulangan otomatis: kegagalan sementara (502, 503, 504, 408, 429, `ECONNREFUSED`, timeout) diulang menggunakan exponential backoff dan jitter penuh.

- **Filter Idempotensi**: Hanya metode HTTP idempoten (`GET`, `PUT`, `DELETE`, `HEAD`, `OPTIONS`) yang diulang. Request `POST` hanya dieksekusi sekali untuk mencegah duplikasi efek samping.
- **Jitter dan Anggaran Waktu**: Jitter mencegah lonjakan thundering herd. Retry berhenti jika akumulasi durasi request melampaui anggaran timeout atau jika circuit breaker berstatus OPEN.

### Health Checker

Health Checker memelihara status kesehatan upstream (`healthy: boolean`) untuk memandu keputusan load balancer dan circuit breaker.

- **Pemeriksaan Aktif**: Secara berkala mengirim `GET /health` ke node backend dan memverifikasi kode status.
- **Pemeriksaan Pasif**: Menilai hasil dan latensi request produksi nyata saat proxy forwarding berlangsung tanpa menghasilkan trafik jaringan tambahan.
- **Histeresis**: Membutuhkan kegagalan berurutan (`unhealthyThreshold`) sebelum menandai node TIDAK SEHAT, dan keberhasilan berurutan (`healthyThreshold`) sebelum mengembalikannya ke status SEHAT.

### Fallback Handler

Fallback Handler menyajikan respons degradasi yang anggun saat request upstream gagal karena timeout, eror, atau circuit breaker yang terbuka:

1. **Fallback Statis**: Respons kustom eksplisit yang dikonfigurasi per rute atau upstream.
2. **Penyajian Basi (Stale Serving)**: Menyajikan kembali respons cache yang kedaluwarsa dalam rentang `ttl + maxStaleAge` disertai header `Warning: 110 - "Response is Stale"`.
3. **Template Standar**: Menghasilkan respons problem JSON berbasis standar RFC (502, 503, 504) dengan header `x-fallback-response: true`.

### Timeout Manager

Timeout Manager menegakkan lima batas durasi operasi agar tidak ada proses yang menggantung tanpa batas:
- `connection` (5 dtk): Batas waktu koneksi soket upstream.
- `request` (30 dtk): Total batas waktu siklus hidup request masuk.
- `upstream` (20 dtk): Batas latensi respons upstream.
- `plugin` (1 dtk): Batas eksekusi plugin tunggal.
- `idle` (60 dtk): Batas waktu diam koneksi dalam pool soket.

## Konfigurasi (Configuration)

Fitur resilience dikonfigurasi per upstream atau secara global dalam `gateway.config.json`:

| Opsi | Tipe | Nilai Bawaan | Dampak |
| --- | --- | --- | --- |
| `upstreams[].healthCheck.enabled` | boolean | `true` | Mengaktifkan pemantauan kesehatan berkala untuk upstream ini. |
| `upstreams[].healthCheck.interval` | number | `10000` | Milidetik antar pemeriksaan kesehatan aktif. |
| `upstreams[].healthCheck.timeout` | number | `5000` | Batas waktu milidetik sebelum pemeriksaan dianggap gagal. |
| `upstreams[].healthCheck.path` | string | `"/health"` | Endpoint HTTP untuk pemeriksaan kesehatan aktif. |
| `upstreams[].healthCheck.expectedStatus` | number | `200` | Kode status HTTP yang diharapkan dari upstream sehat. |
| `circuitBreaker.failureThreshold` | number | `50` | Persentase kegagalan untuk membuka circuit breaker (OPEN). |
| `circuitBreaker.resetTimeout` | number | `60000` | Masa jeda (ms) dalam status OPEN sebelum probe canary. |
| `circuitBreaker.halfOpenSuccessThreshold` | number | `3` | Jumlah sukses canary yang dibutuhkan untuk kembali ke status CLOSED. |
| `retry.maxAttempts` | number | `3` | Jumlah percobaan maksimum untuk kegagalan sementara. |
| `retry.initialDelay` | number | `200` | Delay awal backoff dalam milidetik. |
| `retry.maxDelay` | number | `5000` | Batas maksimum delay exponential backoff. |
| `retry.jitter` | boolean | `true` | Menerapkan variasi acak (jitter) pada interval jeda. |
| `fallback.enableStaleFallback` | boolean | `true` | Mengizinkan penyajian cache kedaluwarsa saat backend down. |
| `fallback.maxStaleAge` | number | `300000` | Usia basi maksimum (ms) untuk data cache fallback. |

## Interaksi Pipeline (Interactions)

Komponen resilience bekerja sama secara erat dalam fase penerusan proxy:

1. **Routing dan Penyaringan**: Router memilih rute. Health Checker menyediakan daftar node upstream sehat ke load balancer.
2. **Pemeriksaan Circuit**: Sebelum meminjam soket dari `HttpClientPool`, Circuit Breaker memverifikasi status target. Breaker `OPEN` langsung mengalihkan request ke Fallback Handler.
3. **Eksekusi & Loop Retry**: Retry Manager membungkus penerusan upstream. Jika panggilan gagal dengan status retryable atau network timeout, penundaan backoff diterapkan sebelum mencoba kembali.
4. **Pengiriman Fallback**: Jika seluruh percobaan retry habis atau batas timeout tercapai, Fallback Handler menangkap eror dan mengembalikan template statis, cache basi, atau JSON terstruktur.
5. **Umpan Balik Pasif**: Keberhasilan atau kegagalan request memperbarui penghitung health check pasif dan sliding window circuit breaker.

## Tradeoff dan Mode Kegagalan (Tradeoffs and failure modes)

- **Pencegahan Kegagalan Beruntun vs Ketersediaan**: Circuit breaker mengorbankan ketersediaan sesaat dari node yang bermasalah untuk melindungi gateway dan upstream lain dari kehabisan pool soket.
- **Amplifikasi Retry**: Mengulang request ke backend yang kelebihan beban dapat memperburuk kondisi backend. Retry Manager memitigasinya dengan membatasi retry hanya untuk metode idempoten, memakai jitter, dan memeriksa status breaker sebelum mengulang.
- **Konsistensi Stale Serving**: Penyajian cache basi meningkatkan uptime saat outage dengan kompromi eventual consistency. Klien menerima header peringatan `Warning: 110`.
- **Mitigasi Flapping**: Ambang batas histeresis pada Health Checker mencegah node berpindah-pindah status sehat-sakit secara liar akibat fluktuasi jaringan sesaat.
