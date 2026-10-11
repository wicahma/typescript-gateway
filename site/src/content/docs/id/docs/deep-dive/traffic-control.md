---
title: "Traffic Control"
description: "Rate limiting, response caching, dan load balancing lintas upstream."
---

Setiap fitur di grup ini sudah **terimplementasi dan terverifikasi**, masing-masing dengan cakupan unit dan integration test di test suite repo.

## Apa yang Dilakukannya (What it does)

Traffic control mengatur aliran, volume, dan distribusi request ke instance backend serta melindungi backend dari kelebihan beban (saturasi).

### Load Balancer

Load Balancer memilih satu upstream sehat untuk setiap request masuk. Lima algoritma dapat dipilih:
- **`round-robin`** (bawaan): Distribusi sekuensial siklis (`index % n`).
- **`least-connections`**: Mengarahkan request ke instance backend dengan jumlah koneksi aktif paling sedikit.
- **`weighted-round-robin`**: Mengalokasikan slot virtual berdasarkan konfigurasi `weight` (misal bobot 3 menerima 3× lebih banyak request).
- **`ip-hash`**: Melakukan hash pada IP klien (`md5(clientIp)`) untuk sesi sticky. Kembali ke round-robin jika IP klien tidak tersedia.
- **`random`**: Mendistribusikan trafik secara acak merata.

### Rate Limiter

Rate Limiter menegakkan batas kuota request per IP klien, per kunci API, atau per rute untuk mencegah penyalahgunaan dan lonjakan trafik:
- **Token Bucket (`TokenBucketRateLimiter`)**: Menyediakan kapasitas burst token yang diisi ulang dengan kecepatan tetap per detik.
- **Sliding Window Counter (`SlidingWindowRateLimiter`)**: Melacak timestamp request dalam bucket waktu geser untuk memastikan batas jendela waktu yang presisi.
- **Header & Problem JSON**: Menyematkan header RFC 6585 (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`) dan respons problem HTTP 429 saat batas terlampaui.

### Response Cache

Response Cache menyimpan respons HTTP upstream di memori untuk melayani request GET/HEAD berulang tanpa latensi upstream:
- **Pembuatan Kunci & Penanganan Vary**: Kunci dihitung melalui `sha256(method | url | sorted varyHeaders)`. Varian terpisah dilacak untuk header seperti `Accept-Encoding`.
- **Eviksi LRU**: Kapasitas memori dibatasi dengan eviksi LRU saat mencapai `maxEntries` atau `maxSize`.
- **Stale-While-Revalidate (SWR)**: Menyajikan respons cache selama jendela revalidasi latar belakang dengan header `x-cache: STALE`.
- **Revalidasi Kondisional**: Mendukung `If-None-Match` (ETag) dan `If-Modified-Since` (negosiasi 304 Not Modified).

## Konfigurasi (Configuration)

Pengaturan traffic control didefinisikan dalam blok `server`, `upstreams`, dan `performance`:

| Opsi | Tipe | Nilai Bawaan | Dampak |
| --- | --- | --- | --- |
| `upstreams[].weight` | number | `1` | Bobot trafik relatif untuk weighted round-robin. |
| `loadBalancer.strategy` | string | `"round-robin"` | Algoritma pemilihan (`round-robin`, `least-connections`, `weighted-round-robin`, `ip-hash`, `random`). |
| `loadBalancer.healthAware` | boolean | `true` | Mengecualikan upstream tidak sehat dari rotasi pemilihan. |
| `rateLimit.capacity` | number | `100` | Kapasitas token maksimum (burst) untuk token bucket. |
| `rateLimit.refillRate` | number | `10` | Jumlah token yang diisi ulang per detik. |
| `rateLimit.windowMs` | number | `60000` | Durasi jendela dalam milidetik untuk sliding window limiter. |
| `responseCache.enabled` | boolean | `true` | Mengaktifkan caching respons inbound. |
| `responseCache.ttlSeconds` | number | `300` | Durasi TTL cadangan jika Cache-Control tidak disertakan backend. |
| `responseCache.maxSize` | number | `104857600` | Batas penyimpanan total memori cache dalam byte (100 MB). |
| `responseCache.maxEntries` | number | `10000` | Jumlah entri respons maksimum yang disimpan di memori. |

## Interaksi Pipeline (Interactions)

Komponen traffic control dieksekusi pada checkpoint tertentu di sepanjang pipeline:

1. **Inbound Rate Limiting**: Dieksekusi selama fase plugin `preRoute` dan inbound policy. Kuota yang terlampaui langsung menghasilkan HTTP 429.
2. **Pencarian Cache**: `ResponseCachePolicy` berjalan sebelum penerusan upstream. Cache hit memotong eksekusi dan mengembalikan payload tersimpan (`x-cache: HIT`).
3. **Pemilihan Upstream**: `LoadBalancer.select()` menyaring upstream sehat dari status `HealthChecker` dan memilih target soket.
4. **Penyimpanan Cache Outbound**: Respons yang dapat di-cache (HTTP 200, GET/HEAD, `Cache-Control` valid) ditangkap, diindeks, dan disimpan ke cache memori.

## Tradeoff dan Mode Kegagalan (Tradeoffs and failure modes)

- **Batas Memori & Eviksi**: Rate Limiter dan Response Cache menyimpan status di memori. Di bawah kardinalitas klien unik yang ekstrem, eviksi LRU membuang entri terlama. Kunci rate limit yang terbuang memulai kuota baru, mencegah crash kehabisan memori dengan kompromi reset kuota sementara.
- **Invalidasi Cache & Kesegaran Data**: Caching memori memberikan throughput tinggi namun bersifat lokal pada node. Restart proses menghapus data cache (kondisi cold cache).
- **Ketidakseimbangan Sesi IP Hashing**: Jika sebagian besar trafik berasal dari proxy korporat atau gateway NAT bersama dengan satu IP klien, `ip-hash` mengarahkan semua trafik tersebut ke satu node backend saja.
- **Perilaku Fail-Safe**: Jika semua target upstream gagal dalam uji kesehatan, `LoadBalancer.select()` mengembalikan `null`, dan gateway langsung mengeluarkan respons 503 Service Unavailable tanpa menggantung koneksi.
