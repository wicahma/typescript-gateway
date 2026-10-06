---
title: "Traffic Control"
description: "Rate limiting, response caching, dan load balancing lintas upstream."
order: 6
section: "Features"
track: "reference"
---

Semua 3 fitur di grup ini sudah **terimplementasi dan terverifikasi** — masing-masing punya pasangan spesifikasi FSD + ERD lengkap dan cakupan unit/integration di test suite repo.

## Load Balancer

Load Balancer memilih satu upstream yang sehat untuk setiap request yang lolos routing
dan rate limiting. Lima algoritma bisa dipilih lewat konfigurasi, dan upstream
yang ditandai tidak sehat otomatis ditarik dari rotasi.

Implementasi: `src/core/load-balancer.ts`, class `LoadBalancer` (313 baris), dipakai oleh
`ProxyHandler` (`src/core/proxy-handler.ts` baris 82, 97, 182). Murni stdlib
(`crypto` untuk IP hashing, `process.hrtime.bigint` untuk durasi) — zero-dep.

### Cara kerjanya

Setiap `select(context)`:

1. **Filter kesehatan** — `healthAware` (default true) membuang upstream dengan
   `healthy === false`. Kalau tidak ada yang tersisa: log `warn` + kembalikan `null`
   (→ proxy handler melempar `No healthy upstream available`).
2. **Pilih algoritma** per `strategy`:
   - **`round-robin`** (default) — siklik `index % n`, satu pointer bergerak.
   - **`least-connections`** — pilih `activeConnections` terkecil (seri → yang pertama).
   - **`weighted-round-robin`** — bangun daftar virtual per weight (`weight || 1`),
     lalu round-robin di atasnya; weight 3 = 3× lebih banyak slot.
   - **`ip-hash`** — `md5(clientIp)` → 8 karakter hex pertama → modulo; client yang sama
     selalu mendarat di upstream yang sama (sticky). Tanpa clientIp → fallback
     round-robin + log `warn`.
   - **`random`** — `Math.random()` memilih secara seragam.
3. **Perbarui metrik** — `totalRequests++` dan `requestsPerUpstream[id]++`.
4. **Debug log** — durasi seleksi (`process.hrtime.bigint()`).

Metrik pendukung: `recordError`, `recordLatency` (moving average per upstream),
`updateHealth` (membalik flag `healthy` upstream + `healthPerUpstream`),
`getDistribution()` (persen per upstream), `getMetrics()`, `resetMetrics()`.

### Konfigurasi

| Option | Default | Location | Effect |
|---|---|---|---|
| `strategy` | `round-robin` | `LoadBalancer(strategy)` | enum: `round-robin` / `least-connections` / `weighted-round-robin` / `ip-hash` / `random` |
| `healthAware` | `true` | `LoadBalancer(strategy, healthAware)` | buang upstream `healthy=false` dari rotasi |
| `weight` | `1` | `upstreams[].weight` di config | hanya berlaku untuk weighted-round-robin |
| `activeConnections` | `0` | runtime, diubah oleh proxy handler | input untuk least-connections |
| `strategy` (config) | — | `performance{}` / upstream config | Field `LoadBalancerStrategy` ada di `UpstreamConfig`; ProxyHandler saat ini menginstansiasi default dan memfilter via routing |

`setStrategy(strategy)` memungkinkan ganti algoritma tanpa restart (me-reset
`currentIndex`); `setHealthAware(bool)` mengaktif/nonaktifkan filter kesehatan saat runtime.

### Edge cases

| Trigger | Behavior | User-visible result |
|---|---|---|
| Semua upstream tidak sehat | `select` mengembalikan `null` | Error proxy `No healthy upstream available` |
| Tersisa satu upstream | `n=1`: modulo selalu 0 | Semua request menuju upstream itu |
| `ip-hash` tanpa client IP | Mundur ke round-robin + log `warn` | Distribusi tidak lagi sticky |
| `ip-hash` saat jumlah upstream berubah | Modulo berubah → remap total | Sesi tidak sticky untuk client yang ter-remap |
| `weight: 0` atau hilang | `weight || 1` → slot 1× | Aman, tidak pernah 0 slot |
| Weight sama pada weighted | Setara round-robin murni | Tanpa bias |
| `activeConnections` tidak dilacak (undefined) | `|| 0` → semua seri | least-connections merosot ke upstream pertama |
| `setUpstreams` diganti saat berjalan | `currentIndex` reset ke 0 | Rotasi mulai lagi dari upstream pertama |
| `Math.random()` untuk random | ≈ distribusi seragam | Tanpa jaminan deterministik (tidak cocok untuk test eksak) |


## Rate Limiter

Rate Limiter membatasi jumlah request yang diterima gateway per satuan waktu,
dikunci per client IP, per header (mis. API key), atau per upstream. Tujuannya melindungi
upstream dari lonjakan trafik dan penyalahgunaan tanpa menambah dependensi eksternal.

Dua algoritma, keduanya in-memory dan zero-dep:

1. **Token Bucket** (`src/core/rate-limiter.ts`, class `TokenBucketRateLimiter`) —
   kapasitas burst `capacity` token, diisi ulang sebesar `refillRate` token/detik. Cocok untuk
   membatasi burst pendek sambil tetap mengizinkan rata-rata konstan.
2. **Sliding Window Counter** (class `SlidingWindowRateLimiter`) — maksimum
   `maxRequests` request dalam sliding window `windowMs`. Cocok untuk kuota keras
   "N per menit" tanpa burst.

Keduanya dibungkus oleh plugin `rate-limit` (`src/plugins/builtin/rate-limit-plugin.ts`)
yang berjalan di hook `preRoute` dan melakukan short-circuit request dengan HTTP 429.

### Konfigurasi

Dikonfigurasi via `plugins[]` di `config/gateway.config.json` (entitas `PLUGIN_CONFIG`,
PERSISTED). Contoh:

```json
{
  "name": "rate-limit",
  "config": {
    "enabled": true,
    "includeHeaders": true,
    "strategies": [
      {
        "name": "per-ip",
        "type": "token-bucket",
        "capacity": 100,
        "refillRate": 10,
        "keyExtractor": "ip",
        "routes": ["/api/*"],
        "statusCode": 429,
        "message": "Too Many Requests"
      },
      {
        "name": "per-key",
        "type": "sliding-window",
        "windowMs": 60000,
        "maxRequests": 1000,
        "keyExtractor": "header",
        "headerName": "x-api-key"
      }
    ]
  }
}
```

| Option | Default | Notes |
|---|---|---|

*(dipangkas — detail lengkap ada di vault proyek)*

### Edge cases

| Trigger | Behavior | User-visible result |
|---|---|---|
| Client baru (key belum pernah terlihat) | Bucket/window dibuat penuh | Request diteruskan normal |
| Burst melebihi `capacity` | Token habis, `allowed = false` | HTTP 429 + `Retry-After` + `X-RateLimit-*` |
| `keyExtractor: "header"` tanpa `headerName` | `extractKey` mengembalikan `null` | Strategy dilewati (fail-open), request diteruskan |
| Header key tidak ada di request | Nilai kosong → `null` | Strategy dilewati |
| `remoteAddress` tidak tersedia | Key `null` | Strategy dilewati (tanpa crash) |
| IP unik lebih banyak dari `maxBuckets` | Eviction LRU bucket tertua | Key yang ter-evict mulai dari awal (kuota reset) — trade-off melawan kehabisan memori |
| Beberapa strategy cocok, satu menolak | Loop berhenti di penolakan pertama | Response 429 dari strategy pertama yang gagal |
| `routes` tidak cocok dengan path | Strategy dilewati | Tidak ada konsumsi token |
| Gateway restart | Semua state in-memory hilang | Kuota reset penuh (TRANSIENT, by design) |


## Response Cache

Response Cache menyimpan response HTTP upstream yang bisa di-cache di memori dan
menyajikannya kembali tanpa menyentuh upstream. Tujuannya memangkas latensi dan beban
upstream untuk GET berulang, dengan semantik HTTP caching yang benar
(`Cache-Control`, ETag, conditional request) — tanpa satu pun dependensi eksternal.

Implementasi: `src/core/response-cache.ts` (`ResponseCache`) plus policy pipeline
`src/pipeline/response-cache-policy.ts` (`ResponseCachePolicy`) yang menyambungkannya
ke inbound chain. Murni `Map` + `node:crypto` untuk hashing key/ETag. Zero-dep.

### Cara kerjanya

1. **Cache key** (`generateKey`): `sha256(method | url | sorted varyHeaders)`.
   Header `Vary` adalah bagian dari key — dan sejak 2026-09-21 policy juga
   melacak header vary apa yang dipakai key tersimpan (`ResponseCache.varyIndex`), jadi
   response yang mendeklarasikan `Vary: Accept-Encoding` di-key ulang per encoding saat
   lookup. Representasi gzip, brotli, dan identity hidup berdampingan; client yang meminta
   encoding yang belum pernah terlihat akan miss alih-alih menerima byte yang salah.
   Lookup dua tahap: coba key khusus-request dulu (tanpa biaya untuk
   entri non-varying), key ulang hanya saat miss.
2. **Penyimpanan** (`set`): tolak response yang lebih besar dari `maxSize`
   (fail-safe, tidak pernah evict demi muat); evict LRU sampai muat (dibatasi `maxEntries` dan
   `maxSize` byte); entri lama dengan key yang sama ditimpa (ukuran didebit dulu).
3. **Pembacaan** (`lookup`): mengembalikan `{ response, state }` dengan state
   `fresh | stale | miss`:
   - Fresh → hit, `hits++`, perbarui LRU.
   - Kedaluwarsa tapi masih dalam `staleWhileRevalidate` → disajikan stale dengan
     `x-cache: STALE`, dan callback `onStaleRevalidate` milik policy menyegarkan
     di background. Penyegaran single-flight per key per window: tanda
     in-flight dibersihkan saat entri segar mendarat (di
     `executeOutbound`), bukan saat callback kembali — satu fetch upstream
     ekstra per window, tanpa stampede.
   - Lebih tua dari itu → entri dihapus, miss.
4. **Cacheability** (`isCacheable`, static): hanya `GET`/`HEAD`, hanya status
   2xx, dan menolak `no-store`, `private`, `no-cache`.
5. **TTL** (`getTTL`): prioritas `s-maxage` → `max-age` → `defaultTTL` (300 detik).
6. **Conditional request** (`checkConditional`): cocokkan `If-None-Match` (ETag,
   termasuk `*` dan daftar) atau `If-Modified-Since` terhadap entri — kecocokan
   berarti 304, bukan body penuh.
7. **Revalidasi kondisional (outbound)**: `etag` dan `last-modified` dari
   response upstream disimpan ke entri saat `set`. Selama revalidasi SWR,
   `ResponseCachePolicy.validatorsFor(key)` mengeksposnya sebagai header
   `If-None-Match` / `If-Modified-Since`; `304 Not Modified` dari upstream
   digabung ke entri via `ResponseCache.refresh(key, headers)` —
   body tidak ditransfer ulang dan masa freshness dimulai lagi.
8. **Purge** (`purge(pattern)`): hapus semua key yang cocok dengan regex, mengembalikan jumlahnya.
9. **Statistik** (`getStats`): `hits`, `misses`, `hitRate`, `entries`, `size`,
   `evictions`.

### Konfigurasi

Belum ada binding ke `gateway.config.json` — class diinstansiasi dengan
default zero-config (pola yang sama seperti fitur observability):

| Option | Default | Meaning |
|---|---|---|
| `maxSize` | `100 MB` | batas total byte body yang di-cache |
| `maxEntries` | `10000` | batas jumlah entri |
| `defaultTTL` | `300` detik | TTL saat upstream tidak mengirim `Cache-Control` |
| `enableStats` | `true` | kumpulkan hits/misses/evictions |

Direncanakan sebagai plugin `cache-control` via `plugins[]`
(PLUGIN_CONFIG) — wiring ke plugin chain
belum ada di kode (lihat Status).

### Edge cases

| Trigger | Behavior | User-visible result |
|---|---|---|
| Response > `maxSize` | `set` mengembalikan `false`, tidak ada yang disimpan | Selalu miss untuk URL itu |
| `maxEntries` tercapai | Evict LRU sampai muat | Entri lama yang jarang diakses hilang (hit rate turun, tanpa error) |
| Entri kedaluwarsa + `stale-while-revalidate` | Disajikan stale dalam window SWR | Response cepat tapi mungkin basi |
| Entri kedaluwarsa melewati SWR | Dihapus saat `get` | Miss; upstream diminta ulang |
| `Cache-Control: no-store` / `private` / `no-cache` | `isCacheable` → false | Tidak pernah disimpan |
| Status non-2xx (termasuk 301/302) | Tidak cacheable | Error/redirect selalu ke upstream |
| POST/PUT/DELETE | Tidak cacheable (cek method) | Selalu ke upstream |
| `If-None-Match` cocok dengan ETag tersimpan | `checkConditional` → true | Caller dapat 304, body tidak ditransfer |
| Nilai `Vary` berbeda antar request | Bagian dari hash key | Dua representasi hidup berdampingan |
| `purge(pattern)` tanpa kecocokan | Mengembalikan 0, tanpa efek | No-op yang aman |
| Proses restart | Cache hilang seluruhnya | Cold cache; semua request ke upstream (TRANSIENT by design) |
