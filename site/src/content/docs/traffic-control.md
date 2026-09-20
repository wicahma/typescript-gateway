---
title: "Traffic Control (F3)"
description: "Rate limiting, response caching, and load balancing across upstreams."
order: 6
section: "Features"
---

# Traffic Control

Rate limiting, response caching, and load balancing across upstreams.

All 3 features in this group are **implemented and verified** — each has a full FSD + ERD spec pair and unit/integration coverage in the repo test suite.

## Load Balancer

Load Balancer memilih satu upstream sehat untuk setiap request yang lolos routing
dan rate limiting. Lima algoritma dapat dipilih konfigurasi, dan upstream yang
ditandai tidak sehat otomatis dikeluarkan dari rotasi.

Implementasi: `src/core/load-balancer.ts`, kelas `LoadBalancer` (313 baris), dipakai
`ProxyHandler` (`src/core/proxy-handler.ts` baris 82, 97, 182). Murni stdlib
(`crypto` untuk IP hash, `process.hrtime.bigint` untuk durasi) — zero-dep.

### How it works

Setiap `select(context)`:

1. **Filter kesehatan** — `healthAware` (default true) membuang upstream dengan
   `healthy === false`. Jika kosong total: log `warn` + return `null`
   (→ proxy handler melempar `No healthy upstream available`).
2. **Pilih algoritma** sesuai `strategy`:
   - **`round-robin`** (default) — siklik `index % n`, satu pointer berjalan.
   - **`least-connections`** — pilih `activeConnections` terkecil (tie → pertama).
   - **`weighted-round-robin`** — bangun list virtual per bobot (`weight || 1`),
     lalu round-robin di atasnya; bobot 3 = slot 3× lebih sering.
   - **`ip-hash`** — `md5(clientIp)` → 8 hex char pertama → modulo; klien yang
     sama selalu ke upstream yang sama (sticky). Tanpa clientIp → fallback
     round-robin + log `warn`.
   - **`random`** — `Math.random()` pilih seragam.
3. **Update metrics** — `totalRequests++` dan `requestsPerUpstream[id]++`.
4. **Log debug** — durasi selection (`process.hrtime.bigint()`).

Metrik pendukung: `recordError`, `recordLatency` (moving average per upstream),
`updateHealth` (mengubah flag `healthy` upstream + `healthPerUpstream`),
`getDistribution()` (persen per upstream), `getMetrics()`, `resetMetrics()`.

### Configuration

| Opsi | Default | Lokasi | Efek |
|---|---|---|---|
| `strategy` | `round-robin` | `LoadBalancer(strategy)` | enum: `round-robin` / `least-connections` / `weighted-round-robin` / `ip-hash` / `random` |
| `healthAware` | `true` | `LoadBalancer(strategy, healthAware)` | buang upstream `healthy=false` dari rotasi |
| `weight` | `1` | `upstreams[].weight` di config | hanya berlaku untuk weighted-round-robin |
| `activeConnections` | `0` | runtime, di-mutasi proxy handler | input least-connections |
| `strategy` (config) | — | `performance{}` / upstream config | field `LoadBalancerStrategy` tersedia di `UpstreamConfig`; ProxyHandler saat ini instantiate default dan filter via routing |

`setStrategy(strategy)` memungkinkan ganti algoritma tanpa restart (reset
`currentIndex`); `setHealthAware(bool)` toggle filter kesehatan saat runtime.

### Edge cases

| Trigger | Perilaku | Hasil user-visible |
|---|---|---|
| Semua upstream tidak sehat | `select` return `null` | Proxy error `No healthy upstream available` |
| Upstream tersisa 1 | `n=1`: modulo selalu 0 | Semua request ke upstream itu |
| `ip-hash` tanpa client IP | Fallback round-robin + log `warn` | Distribusi tidak sticky lagi |
| `ip-hash` saat jumlah upstream berubah | Modulo berubah → remap total | Sesi tidak sticky untuk client yang remap |
| `weight: 0` atau hilang | `weight || 1` → slot 1× | Aman, tidak pernah 0 slot |
| Semua bobot sama pada weighted | Setara round-robin murni | Tidak ada kemudaratan |
| `activeConnections` tidak dilacak (undefined) | `|| 0` → semua tie | least-connections degenerasi ke upstream pertama |
| `setUpstreams` diganti saat berjalan | `currentIndex` reset ke 0 | Rotasi dimulai dari upstream pertama |
| `Math.random()` untuk random | Distribusi ≈ uniform | Tidak ada jaminan deterministik (tidak cocok untuk test eksak) |


## Rate Limiter

Rate Limiter membatasi jumlah request yang diterima gateway per satuan waktu,
dengan kunci per client IP, per header (mis. API key), atau per upstream. Tujuannya
melindungi upstream dari lonjakan trafik dan abuse tanpa menambah dependensi eksternal.

Dua algoritma, keduanya in-memory dan zero-dep:

1. **Token Bucket** (`src/core/rate-limiter.ts`, kelas `TokenBucketRateLimiter`) —
   kapasitas burst `capacity` token, isi ulang `refillRate` token/detik. Cocok untuk
   membatasi burst pendek sambil mengizinkan rata-rata konstan.
2. **Sliding Window Counter** (kelas `SlidingWindowRateLimiter`) — maksimum
   `maxRequests` request dalam jendela geser `windowMs`. Cocok untuk kuota hard
   "N per menit" tanpa burst.

Keduanya dibungkus plugin `rate-limit` (`src/plugins/builtin/rate-limit-plugin.ts`)
yang berjalan pada hook `preRoute` dan short-circuit request dengan HTTP 429.

### Configuration

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

| Opsi | Default | Keterangan |
|---|---|---|

*(trimmed — full detail lives in the project vault)*

### Edge cases

| Trigger | Perilaku | Hasil user-visible |
|---|---|---|
| Klien baru (kunci belum ada) | Bucket/window dibuat penuh | Request diteruskan normal |
| Burst melebihi `capacity` | Token habis, `allowed = false` | HTTP 429 + `Retry-After` + `X-RateLimit-*` |
| `keyExtractor: "header"` tanpa `headerName` | `extractKey` return `null` | Strategi di-skip (fail-open), request diteruskan |
| Header kunci tidak ada di request | Value kosong → `null` | Strategi di-skip |
| `remoteAddress` tidak tersedia | Kunci `null` | Strategi di-skip (tidak crash) |
| Lebih dari `maxBuckets` IP unik | Eviction LRU bucket tertua | Kunci ter-evict mulai fresh (kuota reset) — trade-off anti memory exhaustion |
| Beberapa strategi match, satu menolak | Loop berhenti pada penolakan pertama | Response 429 dari strategi pertama yang gagal |
| `routes` tidak cocok path | Strategi di-skip | Tidak ada konsumsi token |
| Gateway restart | Semua state in-memory hilang | Kuota reset penuh (TRANSIENT, by design) |


## Response Cache

Response Cache menyimpan respons HTTP upstream yang dapat di-cache di memori dan
menyajikannya kembali tanpa menyentuh upstream. Tujuannya memotong latensi dan beban
upstream untuk GET yang berulang, dengan semantik HTTP caching yang benar
(`Cache-Control`, ETag, conditional request) — tanpa satu pun dependensi eksternal.

Implementasi: `src/core/response-cache.ts`, kelas `ResponseCache` (514 baris).
Murni `Map` + `node:crypto` untuk hashing kunci/ETag. Zero-dep.

### How it works

1. **Kunci cache** (`generateKey`): `sha256(method | url | varyHeaders terurut)`.
   Header `Vary` disertakan dalam kunci sehingga representasi per-header berbeda
   tersimpan terpisah.
2. **Menyimpan** (`set`): tolak respons yang lebih besar dari `maxSize`
   (fail-safe, bukan evict); evict LRU sampai muat (batas `maxEntries` dan
   `maxSize` byte); entry lama dengan kunci sama ditimpa (ukuran didebit dulu).
3. **Membaca** (`get`): cek usia `(now - cachedAt)/1000` terhadap `ttl`:
   - Segar → hit, `hits++`, update LRU.
   - Kedaluwarsa tapi dalam `staleWhileRevalidate` → tetap disajikan (stale),
     penelepon yang me-revalidate di background.
   - Lebih tua dari itu → entry dihapus, miss.
4. **Cacheability** (`isCacheable`, static): hanya `GET`/`HEAD`, hanya status
   2xx, dan tolak `no-store`, `private`, `no-cache`.
5. **TTL** (`getTTL`): prioritas `s-maxage` → `max-age` → `defaultTTL` (300 detik).
6. **Conditional request** (`checkConditional`): cocokkan `If-None-Match` (ETag,
   termasuk `*` dan daftar) atau `If-Modified-Since` terhadap entry — pembandingan
   sukses berarti 304, bukan body penuh.
7. **Purge** (`purge(pattern)`): hapus semua kunci yang cocok regex, return jumlah.
8. **Statistik** (`getStats`): `hits`, `misses`, `hitRate`, `entries`, `size`,
   `evictions`.

### Configuration

Tidak ada binding ke `gateway.config.json` saat ini — kelas di-instantiate dengan
default zero-config (pola sama dengan fitur observability):

| Opsi | Default | Arti |
|---|---|---|
| `maxSize` | `100 MB` | batas total byte body ter-cache |
| `maxEntries` | `10000` | batas jumlah entry |
| `defaultTTL` | `300` detik | TTL saat upstream tidak mengirim `Cache-Control` |
| `enableStats` | `true` | kumpulkan hits/misses/evictions |

Direncanakan sebagai `cache-control` plugin via `plugins[]`
(PLUGIN_CONFIG) — wiring ke plugin chain
belum ada di kode (lihat Status).

### Edge cases

| Trigger | Perilaku | Hasil user-visible |
|---|---|---|
| Respons > `maxSize` | `set` return `false`, tidak menyimpan apa pun | Selalu miss untuk URL tersebut |
| `maxEntries` tercapai | Evict LRU sampai muat | Entry lama yang jarang diakses hilang (hit rate turun, tidak ada error) |
| Entry kedaluwarsa + `stale-while-revalidate` | Disajikan stale dalam jendela SWR | Respons cepat tapi mungkin basi |
| Entry kedaluwarsa melewati SWR | Dihapus saat `get` | Miss; upstream diminta ulang |
| `Cache-Control: no-store` / `private` / `no-cache` | `isCacheable` → false | Tidak pernah tersimpan |
| Status non-2xx (termasuk 301/302) | Tidak cacheable | Error/redirect selalu ke upstream |
| POST/PUT/DELETE | Tidak cacheable (method check) | Selalu ke upstream |
| `If-None-Match` cocok ETag ter-cache | `checkConditional` → true | Penelepon mengirim 304, body tidak ditransfer |
| Nilai `Vary` berbeda antar request | Bagian dari hash kunci | Dua representasi hidup berdampingan |
| `purge(pattern)` tanpa cocok | Return 0, tidak ada efek | Operasi no-op aman |
| Restart proses | Cache hilang total | Cold cache; semua request ke upstream (TRANSIENT by design) |
