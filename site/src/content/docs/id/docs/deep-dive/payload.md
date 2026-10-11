---
title: "Penanganan Payload"
description: "Parsing body, transformasi request/response, dan kompresi native."
---

Setiap fitur di grup ini sudah **terimplementasi dan terverifikasi**, masing-masing dengan cakupan unit dan integration test di test suite repo.

## Apa yang Dilakukannya (What it does)

Subsistem payload menangani decoding body request, transformasi konten, dan kompresi respons tanpa dependensi eksternal.

### Body Parser

Body Parser berfungsi sebagai batas kepercayaan pertama untuk payload yang masuk:
- **Ingesti Berbasis Stream**: Membaca stream body untuk format JSON, URL-encoded, multipart, teks, dan biner mentah.
- **Penegakan Batas Konten**: Menerapkan batas ukuran per tipe konten sebelum membaca stream untuk menangkal serangan slowloris dan payload raksasa.
- **Integritas Header**: Memverifikasi jumlah byte akumulatif terhadap header `Content-Length`, menolak header yang dipalsukan dengan HTTP 413.

### Compression Handler

Compression Handler menyediakan kompresi stream tanpa dependensi menggunakan `node:zlib`:
- **Negosiasi Algoritma**: Mengevaluasi parameter kualitas `Accept-Encoding` klien (`q-values`) terhadap preferensi algoritma server (`br`, `gzip`, `deflate`).
- **Penyaringan Konten**: Hanya mengompresi payload jika ukurannya melebihi ambang batas (bawaan 1024 byte) dan cocok dengan MIME type kompresibel (`application/json`, `text/*`, `application/xml`).
- **Sinkronisasi Header**: Menyematkan header `Content-Encoding`, memperbarui `Content-Length`, dan mengelola `Vary: Accept-Encoding`.

### Request Transformer

Mesin transformasi deklaratif yang dieksekusi sebelum penerusan upstream:
- **Penulisan Ulang Header dan Path**: Memodifikasi, mengganti nama, dan membersihkan header, menulis ulang query string URL, serta menerapkan substitusi regex pada path.
- **Penulisan Ulang Body**: Menyisipkan atau menghapus field JSON menggunakan sintaks dot-path (`data.user.id`) atau memodifikasi form URL-encoded.
- **Pertahanan Prototype**: Secara otomatis memblokir vektor prototype pollution (`__proto__`, `constructor`, `prototype`).

### Response Transformer

Dieksekusi setelah respons proxy upstream diterima:
- **Pemetaan Status**: Menerjemahkan kode status HTTP upstream ke kode standar klien.
- **Pembungkusan Envelope**: Membungkus payload backend mentah dalam amplop JSON terstandarisasi.
- **Injeksi CORS & Templating Eror**: Menggantikan header CORS dan menukar halaman eror backend mentah dengan JSON standar gateway.

## Konfigurasi (Configuration)

Opsi payload ditentukan dalam `gateway.config.json` dan konfigurasi handler internal:

| Opsi | Tipe | Nilai Bawaan | Dampak |
| --- | --- | --- | --- |
| `bodyParser.enabled` | boolean | `true` | Mengaktifkan parsing body request yang masuk. |
| `bodyParser.limits.json` | number | `1048576` | Batas maksimum payload JSON dalam byte (1 MB). |
| `bodyParser.limits.urlencoded` | number | `1048576` | Batas maksimum payload URL-encoded dalam byte (1 MB). |
| `bodyParser.limits.multipart` | number | `10485760` | Batas maksimum payload multipart dalam byte (10 MB). |
| `bodyParser.timeout` | number | `30000` | Batas waktu membaca stream dalam milidetik sebelum memutus soket. |
| `compression.enabled` | boolean | `true` | Mengaktifkan kompresi respons HTTP. |
| `compression.algorithms` | array | `["br", "gzip", "deflate"]` | Urutan preferensi algoritma kompresi server. |
| `compression.level` | number | `6` | Tingkat efisiensi kompresi (0-9 gzip/deflate, 0-11 Brotli). |
| `compression.threshold` | number | `1024` | Ukuran payload minimum dalam byte untuk memicu kompresi. |
| `proxy.enableRequestTransformations` | boolean | `true` | Mengaktifkan aturan transformasi header dan body request masuk. |
| `proxy.enableResponseTransformations` | boolean | `true` | Mengaktifkan aturan transformasi status dan header respons keluar. |

## Interaksi Pipeline (Interactions)

Komponen payload beroperasi pada perbatasan ingress dan egress pipeline request:

1. **Parsing Ingress (Langkah 1-3)**: `ProxyHandler` memeriksa ukuran keseluruhan request, menjalankan aturan `RequestTransformer` untuk menulis ulang path dan header, serta mengeksekusi `BodyParser` pada stream masuk.
2. **Penerusan Upstream**: Header yang dinormalisasi dan buffer body yang telah di-parse diteruskan melalui `HttpClientPool`.
3. **Transformasi Egress (Langkah 6)**: Respons upstream dicegat oleh `ResponseTransformer` untuk menerapkan pemetaan status, header CORS, dan template eror.
4. **Kompresi (Langkah 7)**: `CompressionHandler` menegosiasikan encoding dengan header klien dan mengalirkan byte terkompresi ke soket klien.

## Tradeoff dan Mode Kegagalan (Tradeoffs and failure modes)

- **Semantik Transformasi Fail-Open**: Jika penulisan ulang body JSON gagal karena konten malformed, transformer mencatat log eror dan meneruskan payload asli apa adanya, bukan menghasilkan 500 Internal Server Error.
- **Overhead CPU Kompresi**: Kompresi Brotli dan gzip memakan siklus CPU pada throughput tinggi. Ambang batas 1024 byte mencegah pemborosan CPU untuk payload kecil yang rasio kompresinya tidak signifikan.
- **Penanganan Payload Chunked**: Request chunked tanpa header `Content-Length` melewati pra-pemeriksaan ukuran, namun tetap dijaga saat konsumsi stream dan dibatalkan dengan HTTP 413 jika akumulasi byte melebihi batas.
- **Konsumsi Memori Transformasi**: Mem-parse dan menulis ulang payload JSON besar membutuhkan buffering di memori. Untuk file statis atau stream video besar, transformasi sebaiknya dinonaktifkan agar melewati jalur streaming tanpa alokasi memori.
