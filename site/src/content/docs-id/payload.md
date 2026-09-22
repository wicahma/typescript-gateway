---
title: "Payload Handling"
description: "Body parsing, transformasi request/response, dan compression native."
order: 7
section: "Features"
track: "reference"
---

Semua 4 fitur di grup ini sudah **terimplementasi dan terverifikasi** — masing-masing punya pasangan spesifikasi FSD + ERD lengkap dan cakupan unit/integration di test suite repo.

## Body Parser

- **Spek:** Parser body request berbasis stream untuk gateway zero-dependency. Menerima `IncomingMessage` Node.js dan mengembalikan `ParsedBody` terstruktur per Content-Type: JSON, URL-encoded, multipart, text, dan binary mentah (fallback `application/octet-stream`).
- **Tujuan:** Menjadi trust boundary pertama untuk payload masuk — menegakkan batas ukuran per content-type, membatasi waktu baca stream, dan menormalisasi body sebelum diteruskan ke request transformer, plugin, dan upstream.

### Cara kerjanya

1. Deteksi Content-Type dari header (parameter seperti `charset` diabaikan; pencocokan kata kunci `json`/`urlencoded`/`multipart`/`text`; tanpa header → `application/octet-stream`).
2. Pre-check `Content-Length` terhadap batas per tipe (`limits.json`, `limits.urlencoded`, `limits.multipart`, `limits.text`); pelanggaran langsung ditolak tanpa membaca stream (`BODY_TOO_LARGE`, HTTP 413).
3. Baca stream via `readBody()`: akumulasi chunk ke array `Buffer[]`, verifikasi total byte terhadap `Content-Length` yang diklaim (`SIZE_EXCEEDED`, HTTP 413 — melindungi dari header palsu), timer `timeout` (default 30000 ms) menghancurkan koneksi (`TIMEOUT`, HTTP 408), event `error` → `STREAM_ERROR`.
4. Transformasi per tipe: JSON → `JSON.parse` (`INVALID_JSON`, 400); URL-encoded → parser query-string sendiri dengan dukungan multi-value sebagai array (`INVALID_URLENCODED`, 400); multipart → buffer mentah (parsing part penuh sengaja tidak dibangun, lihat Out of Scope di FSD); text → string UTF-8; raw → buffer apa adanya.
5. `ParsedBody { data?, buffer?, stream?, contentType, size }` yang dihasilkan dipakai oleh `ProxyHandler` (langkah pipeline 3) sebagai `BODY_BUFFER` transien — dilepas bersama berakhirnya request, tidak pernah dipersist.

### Konfigurasi

- `gateway.config.json → bodyParser` (`BodyParserConfig` di `src/types/core.ts`):
  - `enabled` (boolean, default `true`)
  - `limits` (byte): `json` 1 MB, `urlencoded` 1 MB, `multipart` 10 MB, `text` 1 MB
  - `timeout` (ms, default 30000)
  - `enablePooling` (boolean, default `true`) — me-pool `ParsedBody` per tipe (maks 100 entri per pool)
- Level pipeline: `enableBodyParsing` di `ProxyHandlerConfig` (default `true`) menentukan apakah parsing dipanggil sama sekali.
- Batas request global: `maxRequestSize` (default 10 MB) diverifikasi dulu oleh `ProxyHandler`.

### Edge cases

- **`Content-Length` palsu (lebih kecil dari body asli):** akumulasi `readBody` mendeteksi `totalLength > expectedLength`, stream dihancurkan, HTTP 413.
- **Tanpa `Content-Length` (chunked):** `getContentLength` mengembalikan 0, pre-check dilewati; batas tetap ditegakkan via `SIZE_EXCEEDED` hanya ketika header ada — body chunked dicek terhadap batas per tipe selagi dibaca.
- **Streaming lambat (slowloris):** timer 30 s menghancurkan socket, HTTP 408.
- **JSON valid secara sintaks tapi besar di atas batas:** ditolak sebelum `JSON.parse` — tidak ada CPU terbuang untuk payload yang toh akan ditolak.
- **Content-Type tidak dikenal:** mundur ke buffer mentah; gateway tetap bisa me-proxy-nya tanpa memahami isinya.


## Compression Handler

- **Spek:** Kompresor HTTP response berbasis `node:zlib` — gzip, Brotli (`br`), dan deflate — dengan negosiasi `Accept-Encoding` (dukungan q-value dan wildcard `*`), filter content-type, threshold ukuran minimum, dan penulisan header `Content-Encoding` / `Content-Length` / `Vary: Accept-Encoding`.
- **Tujuan:** Hemat bandwidth tanpa dependensi eksternal (stdlib `node:zlib`), dengan urutan preferensi yang bisa dikonfigurasi (Brotli pertama secara default karena ratio terbaik untuk JSON/text).

### Cara kerjanya

1. **Negosiasi** (`negotiateAlgorithm(acceptEncoding)`): parse header menjadi daftar `{ encoding, quality }` (q default 1.0, q ≤ 0 dibuang), urutkan menurun berdasarkan quality, lalu pilih algoritma pertama dari `config.algorithms` (urutan preferensi server) yang diterima client atau yang dicakup `*`. Tanpa header / `enabled=false` → `null` (identity).
2. **Filter** (`shouldCompress(contentType, contentLength, acceptEncoding)`): kompres hanya kalau enabled, client mengirim `Accept-Encoding`, ukuran ≥ `threshold` (default 1024 byte), dan content-type cocok dengan `contentTypes` (default: `application/json`, `text/*`, `application/javascript`, `application/xml`; wildcard `*` → regex; parameter seperti `; charset` dibuang).
3. **Compression** (`compress(data, algorithm)`): pipe `Readable.from([data])` ke stream `createGzip`/`createBrotliCompress`/`createDeflate` dengan `level` (default 6; Brotli memakai param quality), kumpulkan chunk → `CompressionResult { data, algorithm, originalSize, compressedSize, ratio, duration }`.
4. **Header** (`addCompressionHeaders`): set `content-encoding` = algoritma, `content-length` = ukuran terkompresi, timpa `vary` dengan `Accept-Encoding` (Vary lama dihapus demi konsistensi).
5. **Deteksi & dekompresi**: `detectAlgorithm(contentEncoding)` mengenali `gzip`/`x-gzip`/`br`/`deflate` — dipakai untuk body upstream yang terkompresi; `decompress()` + `createDecompressionStream()` menyediakan jalur sebaliknya. Varian stream (`createCompressionStream`) tersedia untuk pipeline streaming langsung.
6. Di pipeline: `ProxyHandler` langkah 7 memanggil `shouldCompress` → `negotiateAlgorithm` → `compress` → `addCompressionHeaders` (selalu **setelah** Response-Transformer, supaya body terkompresi bersifat final). Metrik `originalSize`/`compressedSize`/`duration` dicatat ke `advancedMetrics.recordCompression()`.

### Konfigurasi

- `CompressionConfig` (bisa diubah saat runtime via `updateConfig()`):
  - `enabled` (default `true`); `algorithms: ['br', 'gzip', 'deflate']` (urutan = preferensi)
  - `level`: 6 (0–9 gzip/deflate, 0–11 quality Brotli)
  - `threshold`: 1024 byte
  - `contentTypes`: `['application/json', 'text/*', 'application/javascript', 'application/xml']`
- Saklar pipeline: `enableCompression` di `ProxyHandlerConfig` (default `true`).
- `getStats()` / `getConfig()` untuk introspeksi.

### Edge cases

- **Client tanpa `Accept-Encoding`:** tidak dikompresi (identity), per RFC 7231.
- **`Accept-Encoding: *`:** dipetakan ke algoritma pertama yang dikonfigurasi.
- **q=0:** encoding dianggap tidak diterima, dibuang sebelum pencocokan.
- **Payload di bawah threshold:** dikirim apa adanya — mengompresi payload kecil sering malah memperbesar + buang CPU.
- **Content-type tidak terdaftar (mis. gambar):** dikirim mentah; mengompresi media yang sudah terkompresi tidak efektif.
- **`x-gzip`:** dikenali sebagai gzip (kompatibilitas legacy).
- **Buffer kosong / payload kecil:** round-trip compress-decompress tetap benar (tercakup test Edge Cases).


## Request Transformer

- **Spek:** Mesin transformasi request deklaratif yang berjalan di pipeline gateway (langkah 2, sebelum body parsing dan pemilihan upstream). Bisa menulis ulang header, parameter query, path, dan body (JSON/form) berdasarkan aturan per-rute dengan kondisi (header, path, method, query param) dan prioritas.
- **Tujuan:** Menghapus kebutuhan upstream menangani variasi client — normalisasi header, pembuangan parameter internal, rewrite path legacy, injeksi field body — semua di edge, tanpa dependensi eksternal.

### Cara kerjanya

1. Aturan `RequestTransformation` didaftarkan via `addTransformation()` / `setTransformations()`; otomatis diurutkan menurun berdasarkan `priority` (tertinggi jalan duluan).
2. `transform(method, path, headers, body)` meng-clone header (tidak pernah memutasi input), lalu untuk setiap aturan yang lolos `shouldApply()`:
   - **headers**: `add` (dinormalisasi ke lowercase), `remove` (eksak atau wildcard `*` → regex case-insensitive), `rename`, `modify` (penggantian string dengan regex).
   - **query**: `add`/`remove`/`modify` via `URLSearchParams` — `add` memakai `set` jadi menimpa nilai duplikat.
   - **pathRewrite**: daftar aturan `{ pattern, replacement }`; path dipisah dari query string dulu, lalu regex `test` diikuti `replace`.
   - **body**: JSON (`application/json`, `application/vnd.api+json`) → `set`/`remove` per dot-path; form (`x-www-form-urlencoded`) → `set`/`remove` via `URLSearchParams`.
3. Kondisi `shouldApply()`: `routes` (pola wildcard), `conditions.header` (eksak/RegExp), `conditions.path`, `conditions.method` (string/array), `conditions.queryParam` (keberadaan).
4. Hasil `TransformationResult { headers, path, queryString, body?, duration }` — path final direkonstruksi sebagai `pathWithoutQuery?queryString`. Durasi dicatat ke `advancedMetrics.recordRequestTransformation()` kalau aktif.
5. Body transform yang gagal (JSON rusak) **tidak** melempar error: body asli diteruskan apa adanya dan kegagalan dicatat di level `error` — fail-open supaya request pengguna tidak pernah dibuang oleh transformasi kosmetik.

### Konfigurasi

- `enableRequestTransformations` di `ProxyHandlerConfig` (default `true`) — saklar pipeline.
- Aturan didaftarkan secara programatik via `ProxyHandler.getRequestTransformer()`; tidak ada section `requestTransformations` di `gateway.config.json` (config deklaratif menyusul, lihat FSD Out of Scope).
- `getStats()` mengekspos `totalTransformations`; `clear()` menghapus semua aturan.

### Edge cases

- **Prototype pollution:** `setJsonPath`/`deleteJsonPath` memblokir segmen `__proto__`, `constructor`, `prototype` — dicatat di `warn` dan path diabaikan.
- **Body JSON rusak di bawah aturan body:** body asli diteruskan tanpa error ke client.
- **Header bernilai array:** nilai pertama yang dipakai untuk kondisi dan `modify`.
- **Aturan pathRewrite dengan regex tidak valid:** regex dikompilasi saat eksekusi; error merambat ke caller pipeline.
- **Prioritas sama:** urutan insert stabil setelah pengurutan.


## Response Transformer

- **Spek:** Mesin transformasi response deklaratif di pipeline gateway (langkah 6, setelah proxying upstream selesai, sebelum compression). Mengubah status code (mapping), header, body JSON (wrap/set/remove), CORS, dan mengganti body error dengan template per status code — berdasarkan aturan per-rute dengan kondisi dan prioritas.
- **Tujuan:** Menyembunyikan keanehan upstream dari client: normalisasi status code, injeksi header security/CORS, bungkus response dalam envelope yang konsisten, dan ganti halaman error mentah upstream dengan template gateway.

### Cara kerjanya

1. Aturan `ResponseTransformation` didaftarkan via `addTransformation()` / `setTransformations()`; diurutkan menurun berdasarkan `priority`.
2. `transform(requestPath, statusCode, headers, body)` meng-clone header, lalu untuk setiap aturan yang lolos `shouldApply()`:
   - **statusCodeMap**: `kode upstream → kode gateway` (mencari kode yang sudah ditransformasi oleh aturan sebelumnya — chaining lintas aturan).
   - **headers**: `add` (lowercase), `remove` (eksak/wildcard `*`), `rename`.
   - **cors** (`enabled: true`): set `access-control-allow-origin` (`*` atau origin pertama dari allow-list), `-allow-methods`, `-allow-headers`, `-expose-headers`, `-allow-credentials`, `-max-age`.
   - **errorTemplates** (hanya saat status ≥ 400): template pertama yang `statusCodes`-nya cocok mengganti body (string atau objek → JSON) + header tambahan milik template.
   - **body**: JSON (`application/json`, `application/vnd.api+json`) → `wrap` (membungkus seluruh payload dalam satu field), `set`, `remove` per dot-path.
3. Kondisi `shouldApply()`: `routes` (wildcard), `conditions.statusCode` (number/array), `conditions.header`, `conditions.contentType` (string includes / RegExp).
4. Hasil `ResponseTransformationResult { statusCode, headers, body?, duration }`; durasi dicatat ke `advancedMetrics.recordResponseTransformation()`.
5. Body transform yang gagal (JSON rusak) → body asli diteruskan, dicatat di level `error` — fail-open, sama seperti Request-Transformer.

### Konfigurasi

- `enableResponseTransformations` di `ProxyHandlerConfig` (default `true`) — saklar pipeline.
- Aturan programatik via `ProxyHandler.getResponseTransformer()`; tidak ada section deklaratif di `gateway.config.json` (lihat FSD Out of Scope).
- `getStats()` → `totalTransformations`; `clear()` me-reset.

### Edge cases

- **Upstream sudah mengirim CORS:** aturan `add` menimpa header upstream — operator menentukan kebijakan CORS final di gateway.
- **Error template terpicu pada body binary:** template mengganti body apa adanya (template hanya berlaku untuk status ≥ 400, kasus ini disengaja).
- **Chaining statusCodeMap lintas aturan:** aturan berprioritas rendah membaca hasil mapping prioritas tinggi; kondisi `statusCode` dicek terhadap kode asli (pra-mapping).
- **Body JSON rusak di bawah aturan body:** body asli diteruskan, client tidak pernah melihat 500 dari transformer.
- **Prototype pollution:** `__proto__`/`constructor`/`prototype` diblokir di `setJsonPath`/`deleteJsonPath`.
