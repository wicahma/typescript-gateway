---
title: "Identitas & Keamanan"
description: "JWT auth, mesin API-key, injeksi kredensial upstream, eror RFC 7807."
---

Setiap fitur di grup ini sudah **terimplementasi dan terverifikasi**, masing-masing dengan cakupan unit dan integration test di test suite repo.

## Apa yang Dilakukannya (What it does)

Subsistem identitas dan keamanan menyediakan autentikasi pemanggil, otorisasi per-konsumen dinamis, pembersihan header, penyeragaman format eror RFC 7807, dan injeksi kredensial upstream tanpa dependensi pihak ketiga.

### API Key Engine

Mesin identitas dan token konsumen berkecepatan tinggi:
- **Format Token**: `tsgk_<bucket>_<random32>_<checksum4>` yang terdiri dari bucket lingkungan, 32 karakter acak base62, dan checksum CRC32 untuk penolakan typo O(1).
- **Verifikasi Bertingkat**: Regex format cepat -> evaluasi checksum waktu-konstan -> pencarian cache LRU/TTL -> verifikasi consumer store.
- **Injeksi Context**: Mengisi `ctx.state['user'] = { sub: consumerId, data: { plan, rateLimit } }` untuk menggerakkan pembatasan kuota spesifik per konsumen.

### JWT Auth Plugin

OAuth2/JWT Resource Server mandiri yang dibangun murni menggunakan `node:crypto`:
- **Validasi Kriptografis**: Memvalidasi tanda tangan RS256 terhadap koleksi JSON Web Key Sets (JWKS) lokal.
- **Penegakan Klaim**: Menegakkan klaim `iss`, `aud`, dan `exp` dengan toleransi pergeseran jam (`leewaySeconds`).
- **Pencegahan Pemalsuan Identitas**: Menghapus semua header masuk yang cocok dengan `/^(x-auth-|x-user-|x-roles|x-scopes|x-email)/i` sebelum request diteruskan ke upstream.

### RFC 7807 Problem Details

Menyeragamkan respons eror API menjadi payload standar RFC 7807:
- **Struktur Konsisten**: Mengembalikan `type`, `title`, `status`, `detail`, `instance`, dan `requestId` dengan `Content-Type: application/problem+json`.
- **Katalog Bawaan**: Mencakup kode status umum (400, 401, 403, 404, 413, 429, 500, 502, 503, 504).

### Upstream Credential Injection

Mengisolasi otorisasi backend dari klien eksternal:
- **Injeksi Header (`set-upstream-header`)**: Menyisipkan token internal atau header identitas layanan setelah autentikasi klien berhasil.
- **Tanda Tangan HMAC (`upstream-hmac-signature`)**: Menandatangani body request menggunakan HMAC-SHA256 dengan secret bersama, memberikan verifikasi keaslian pengirim bagi layanan microservice backend.

## Konfigurasi (Configuration)

Fitur identitas dan keamanan dikonfigurasi melalui `gateway.config.json`:

| Opsi | Tipe | Nilai Bawaan | Dampak |
| --- | --- | --- | --- |
| `apiKeys.enabled` | boolean | `false` | Mengaktifkan kebijakan validasi API key. |
| `apiKeys.headerName` | string | `"x-api-key"` | Nama header untuk mengekstrak API key. |
| `apiKeys.cacheTtlSeconds` | number | `5` | TTL cache validasi (batas atas durasi penundaan pencabutan kunci). |
| `apiKeys.cacheMaxEntries` | number | `10000` | Kapasitas maksimum entri pada cache API key. |
| `apiKeys.consumers[].consumerId` | string | — | String identitas konsumen yang unik. |
| `apiKeys.consumers[].rateLimit` | number | — | Kuota request masuk per menit untuk konsumen ini. |
| `plugins[auth-jwt].issuer` | string | — | Klaim `iss` yang diharapkan pada token JWT. |
| `plugins[auth-jwt].audience` | string | — | Klaim `aud` yang diharapkan pada token JWT. |
| `plugins[auth-jwt].jwks.keys` | array | `[]` | Kunci publik RSA dalam format JWK. |
| `plugins[auth-jwt].leewaySeconds` | number | `30` | Jendela toleransi pergeseran waktu dalam detik. |

## Interaksi Pipeline (Interactions)

Mekanisme keamanan berjalan berurutan secara ketat di awal pipeline:

1. **Sanitasi Header**: Header `x-auth-*` yang rawan dipalsukan dihapus dari request masuk.
2. **Autentikasi Klien**: Kebijakan JWT atau API key memverifikasi token dan mengisi `ctx.state['user']`.
3. **Rate Limiting Konsumen**: Jika kuota konsumen aktif, pipeline memverifikasi sisa token menggunakan ID konsumen terautentikasi.
4. **Injeksi Kredensial**: Gateway menyematkan token backend atau tanda tangan HMAC ke header request.
5. **Penerusan Proxy**: Request tiba di upstream origin dengan kredensial gateway asli dan header yang bersih.
6. **Intersepsi Eror**: Kegagalan validasi apapun segera menghentikan pipeline dan menghasilkan respons RFC 7807 Problem Details.

## Tradeoff dan Mode Kegagalan (Tradeoffs and failure modes)

- **TTL Cache vs Keterlambatan Pencabutan**: Menyimpan API key yang tervalidasi selama 5 detik meningkatkan throughput secara signifikan, tetapi memberi jeda waktu hingga 5 detik sebelum kunci yang dicabut benar-benar ditolak.
- **Consumer Store di Memori**: Store konsumen bawaan beroperasi sepenuhnya di memori; restart gateway memuat ulang konsumen dari file konfigurasi, membuang status runtime sementara.
- **Pembatasan Algoritma JWT**: Hanya tanda tangan asimetris RS256 yang didukung secara bawaan untuk secara eksplisit mencegah celah `alg=none` dan serangan pertukaran kunci HMAC/RSA.
- **Pencegahan Kebocoran Data Eror**: Respons RFC 7807 tidak pernah mengekspos stack trace atau variabel lingkungan internal ke klien; diagnostik mendalam dicatat secara terpisah pada log akses server.
