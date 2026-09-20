---
title: "Payload Handling (F4)"
description: "Body parsing, request/response transformation, and native compression."
order: 7
section: "Features"
---

# Payload Handling

Body parsing, request/response transformation, and native compression.

All 4 features in this group are **implemented and verified** — each has a full FSD + ERD spec pair and unit/integration coverage in the repo test suite.

## Body Parser

- **Spesifikasi:** Parser body request berbasis stream untuk gateway zero-dependency. Menerima `IncomingMessage` Node.js dan mengembalikan `ParsedBody` terstruktur sesuai Content-Type: JSON, URL-encoded, multipart, text, dan binary raw (fallback `application/octet-stream`).
- **Tujuan:** Menjadi trust boundary pertama untuk payload masuk — membatasi ukuran per content-type, membatasi waktu baca stream, dan menormalkan body sebelum diteruskan ke request transformer, plugin, dan upstream.

### How it works

1. Deteksi Content-Type dari header (parameter seperti `charset` diabaikan; keyword matching `json`/`urlencoded`/`multipart`/`text`; tanpa header → `application/octet-stream`).
2. Pre-check `Content-Length` terhadap limit per type (`limits.json`, `limits.urlencoded`, `limits.multipart`, `limits.text`); pelanggaran langsung ditolak tanpa membaca stream (`BODY_TOO_LARGE`, HTTP 413).
3. Baca stream via `readBody()`: akumulasi chunk ke array `Buffer[]`, verifikasi total byte terhadap `Content-Length` yang diklaim (`SIZE_EXCEEDED`, HTTP 413 — melindungi dari klaim header palsu), timer `timeout` (default 30000 ms) memusnahkan koneksi (`TIMEOUT`, HTTP 408), event `error` → `STREAM_ERROR`.
4. Transformasi per type: JSON → `JSON.parse` (`INVALID_JSON`, 400); URL-encoded → parser query string sendiri dengan dukungan multi-value jadi array (`INVALID_URLENCODED`, 400); multipart → buffer mentah (parsing part penuh sengaja tidak dibangun, lihat Out of Scope di FSD); text → UTF-8 string; raw → buffer apa adanya.
5. Hasil `ParsedBody { data?, buffer?, stream?, contentType, size }` dipakai `ProxyHandler` (Step 3 pipeline) sebagai `BODY_BUFFER` transien — dilepas bersama akhir request, tidak pernah dipersistenkan.

### Configuration

- `gateway.config.json → bodyParser` (`BodyParserConfig` di `src/types/core.ts`):
  - `enabled` (boolean, default `true`)
  - `limits` (bytes): `json` 1 MB, `urlencoded` 1 MB, `multipart` 10 MB, `text` 1 MB
  - `timeout` (ms, default 30000)
  - `enablePooling` (boolean, default `true`) — pool `ParsedBody` per type (maks 100 entri per pool)
- Level pipeline: `enableBodyParsing` pada `ProxyHandlerConfig` (default `true`) memutuskan apakah parse dipanggil sama sekali.
- Batas global request: `maxRequestSize` (default 10 MB) diverifikasi lebih dulu oleh `ProxyHandler`.

### Edge cases

- **`Content-Length` palsu (lebih kecil dari body nyata):** akumulasi `readBody` mendeteksi `totalLength > expectedLength`, stream di-destroy, HTTP 413.
- **Tanpa `Content-Length` (chunked):** `getContentLength` mengembalikan 0, pre-check dilewati; limit tetap ditegakkan lewat `SIZE_EXCEEDED` hanya jika header ada — body chunked mengikuti limit per-type saat dibaca.
- **Timeout streaming lambat (slowloris):** timer 30 s memusnahkan socket, HTTP 408.
- **JSON besar valid secara sintaks tapi > limit:** ditolak sebelum `JSON.parse` — tidak ada CPU yang dibuang untuk payload yang sudah pasti ditolak.
- **Content-Type tidak dikenal:** fallback raw buffer; gateway tetap bisa mem-proxy tanpa memahami isinya.


## Compression Handler

- **Spesifikasi:** Kompresor response HTTP berbasis `node:zlib` — gzip, Brotli (`br`), dan deflate — dengan negosiasi `Accept-Encoding` (dukungan q-values dan wildcard `*`), filter content-type, threshold ukuran minimum, dan penulisan header `Content-Encoding` / `Content-Length` / `Vary: Accept-Encoding`.
- **Tujuan:** Menghemat bandwidth tanpa dependency eksternal (stdlib `node:zlib`), dengan urutan preferensi yang bisa dikonfigurasi (default Brotli dulu karena rasio terbaik untuk JSON/text).

### How it works

1. **Negosiasi** (`negotiateAlgorithm(acceptEncoding)`): parse header menjadi daftar `{ encoding, quality }` (q default 1.0, q ≤ 0 dibuang), urutkan quality menurun, lalu pilih algoritma pertama dari `config.algorithms` (urutan preferensi server) yang diterima klien atau yang dicakup `*`. Tidak ada header / `enabled=false` → `null` (identity).
2. **Filter** (`shouldCompress(contentType, contentLength, acceptEncoding)`): kompres hanya jika enabled, klien mengirim `Accept-Encoding`, ukuran ≥ `threshold` (default 1024 byte), dan content-type cocok dengan `contentTypes` (default: `application/json`, `text/*`, `application/javascript`, `application/xml`; wildcard `*` → regex; parameter seperti `; charset` di-strip).
3. **Kompresi** (`compress(data, algorithm)`): pipakan `Readable.from([data])` ke stream `createGzip`/`createBrotliCompress`/`createDeflate` dengan `level` (default 6; Brotli memakai quality param), kumpulkan chunk → `CompressionResult { data, algorithm, originalSize, compressedSize, ratio, duration }`.
4. **Header** (`addCompressionHeaders`): set `content-encoding` = algoritma, `content-length` = ukuran terkompres, timpa `vary` dengan `Accept-Encoding` (Vary existing dihapus agar konsisten).
5. **Deteksi & dekompresi**: `detectAlgorithm(contentEncoding)` mengenali `gzip`/`x-gzip`/`br`/`deflate` — dipakai untuk body upstream terkompresi; `decompress()` + `createDecompressionStream()` menyediakan jalur balik. Stream versi (`createCompressionStream`) tersedia untuk pipa streaming langsung.
6. Di pipeline: `ProxyHandler` Step 7 memanggil `shouldCompress` → `negotiateAlgorithm` → `compress` → `addCompressionHeaders` (selalu **setelah** Response-Transformer, sehingga body yang dikompres sudah final). Metrik `originalSize`/`compressedSize`/`duration` dicatat ke `advancedMetrics.recordCompression()`.

### Configuration

- `CompressionConfig` (bisa diubah runtime via `updateConfig()`):
  - `enabled` (default `true`); `algorithms: ['br', 'gzip', 'deflate']` (urutan = preferensi)
  - `level`: 6 (0–9 gzip/deflate, 0–11 Brotli quality)
  - `threshold`: 1024 byte
  - `contentTypes`: `['application/json', 'text/*', 'application/javascript', 'application/xml']`
- Saklar pipeline: `enableCompression` pada `ProxyHandlerConfig` (default `true`).
- `getStats()` / `getConfig()` untuk introspeksi.

### Edge cases

- **Klien tanpa `Accept-Encoding`:** tidak dikompres (identity), sesuai RFC 7231.
- **`Accept-Encoding: *`:** dipetakan ke algoritma pertama yang dikonfigurasi.
- **q=0:** encoding dianggap tidak diterima, dibuang sebelum matching.
- **Payload di bawah threshold:** dikirim apa adanya — kompresi payload kecil kerap memperbesar ukuran + boros CPU.
- **Content-type tidak terdaftar (mis. gambar):** dikirim mentah; kompresi media terkompresi tidak efektif.
- **`x-gzip`:** dikenali sebagai gzip (kompatibilitas legacy).
- **Buffer kosong / payload kecil:** round-trip kompres-dekompres tetap benar (tercakup test Edge Cases).


## Request Transformer

- **Spesifikasi:** Mesin transformasi request deklaratif yang berjalan di pipeline gateway (Step 2, sebelum body parsing dan pemilihan upstream). Mampu menulis ulang header, query parameter, path, dan body (JSON/form) berdasarkan aturan per-route dengan kondisi (header, path, method, query param) dan prioritas.
- **Tujuan:** Menghapus kebutuhan upstream menangani variasi klien — normalisasi header, strip parameter internal, rewrite path legacy, injeksi field body — semuanya di edge, tanpa dependency eksternal.

### How it works

1. Aturan `RequestTransformation` didaftarkan via `addTransformation()` / `setTransformations()`; otomatis diurutkan `priority` menurun (tertinggi dieksekusi dulu).
2. `transform(method, path, headers, body)` meng-clone header (tidak pernah memutasi input), lalu untuk tiap aturan yang lolos `shouldApply()`:
   - **headers**: `add` (dinormalisasi lowercase), `remove` (exact atau wildcard `*` → regex case-insensitive), `rename`, `modify` (string replacement dengan regex).
   - **query**: `add`/`remove`/`modify` via `URLSearchParams` — `add` memakai `set` sehingga menimpa nilai duplikat.
   - **pathRewrite**: daftar aturan `{ pattern, replacement }`; path dipisah dari query string dulu, regex di-`test` lalu `replace`.
   - **body**: JSON (`application/json`, `application/vnd.api+json`) → `set`/`remove` by dot-path; form (`x-www-form-urlencoded`) → `set`/`remove` via `URLSearchParams`.
3. Kondisi `shouldApply()`: `routes` (wildcard pattern), `conditions.header` (exact/RegExp), `conditions.path`, `conditions.method` (string/array), `conditions.queryParam` (keberadaan).
4. Hasil `TransformationResult { headers, path, queryString, body?, duration }` — path final direkonstruksi `pathWithoutQuery?queryString`. Durasi dicatat ke `advancedMetrics.recordRequestTransformation()` jika aktif.
5. Body transform gagal (JSON rusak) **tidak** melempar error: body asli diteruskan apa adanya dan kegagalan dicatat log `error` — prinsip fail-open agar request user tidak di-drop oleh transformasi kosmetik.

### Configuration

- `enableRequestTransformations` pada `ProxyHandlerConfig` (default `true`) — saklar pipeline.
- Aturan didaftarkan programatik lewat `ProxyHandler.getRequestTransformer()`; tidak ada section `requestTransformations` di `gateway.config.json` (declarative config menyusul, lihat FSD Out of Scope).
- `getStats()` mengekspos `totalTransformations`; `clear()` mengosongkan aturan.

### Edge cases

- **Prototype pollution:** `setJsonPath`/`deleteJsonPath` memblokir segmen `__proto__`, `constructor`, `prototype` — dicatat `warn` dan path diabaikan.
- **JSON body rusak pada aturan body:** body asli diteruskan tanpa error ke klien.
- **Header array-valued:** nilai pertama yang dipakai untuk kondisi dan `modify`.
- **Aturan pathRewrite dengan regex invalid:** regex dikompilasi saat eksekusi; error menaik ke pemanggil pipeline.
- **Prioritas sama:** urutan insertion yang stabil setelah sort.


## Response Transformer

- **Spesifikasi:** Mesin transformasi response deklaratif di pipeline gateway (Step 6, setelah proxy upstream selesai, sebelum kompresi). Mengubah status code (mapping), header, body JSON (wrap/set/remove), CORS, dan mengganti body error dengan template per status code — berdasarkan aturan per-route dengan kondisi dan prioritas.
- **Tujuan:** Menyembunyikan keanehan upstream dari klien: menormalkan status code, menyuntik header keamanan/CORS, membungkus response dalam envelope konsisten, dan mengganti halaman error mentah upstream dengan template gateway.

### How it works

1. Aturan `ResponseTransformation` didaftarkan via `addTransformation()` / `setTransformations()`; diurutkan `priority` menurun.
2. `transform(requestPath, statusCode, headers, body)` meng-clone header, lalu untuk tiap aturan yang lolos `shouldApply()`:
   - **statusCodeMap**: `upstream code → gateway code` (lookup pada code yang sudah ter-transformasi oleh aturan sebelumnya — chaining antar aturan).
   - **headers**: `add` (lowercase), `remove` (exact/wildcard `*`), `rename`.
   - **cors** (`enabled: true`): set `access-control-allow-origin` (`*` atau origin pertama dari allow-list), `-allow-methods`, `-allow-headers`, `-expose-headers`, `-allow-credentials`, `-max-age`.
   - **errorTemplates** (hanya jika status ≥ 400): template pertama yang `statusCodes`-nya cocok menggantikan body (string atau object → JSON) + header tambahan template.
   - **body**: JSON (`application/json`, `application/vnd.api+json`) → `wrap` (bungkus seluruh payload dalam satu field), `set`, `remove` by dot-path.
3. Kondisi `shouldApply()`: `routes` (wildcard), `conditions.statusCode` (number/array), `conditions.header`, `conditions.contentType` (string includes / RegExp).
4. Hasil `ResponseTransformationResult { statusCode, headers, body?, duration }`; durasi dicatat `advancedMetrics.recordResponseTransformation()`.
5. Body transform gagal (JSON rusak) → body asli diteruskan, log `error` — fail-open, sama dengan Request-Transformer.

### Configuration

- `enableResponseTransformations` pada `ProxyHandlerConfig` (default `true`) — saklar pipeline.
- Aturan programatik via `ProxyHandler.getResponseTransformer()`; tidak ada section declarative di `gateway.config.json` (lihat FSD Out of Scope).
- `getStats()` → `totalTransformations`; `clear()` reset.

### Edge cases

- **Upstream sudah mengirim CORS:** aturan `add` menimpa header upstream — operator yang memutuskan kebijakan CORS final di gateway.
- **Error template dipicu pada body binary:** template menggantikan body apa adanya (template hanya untuk status ≥ 400, kasus ini disengaja).
- **Chaining statusCodeMap antar aturan:** aturan prioritas lebih rendah membaca hasil mapping aturan lebih tinggi; kondisi `statusCode` dicek terhadap code awal (pre-mapping).
- **JSON body rusak pada aturan body:** body asli diteruskan, klien tidak melihat 500 dari transformer.
- **Prototype pollution:** blokir `__proto__`/`constructor`/`prototype` di `setJsonPath`/`deleteJsonPath`.
