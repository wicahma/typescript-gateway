---
title: "Paket Fitur (Feature Pack)"
description: "CORS, W3C trace context, idempotency keys, outbound secret masking, adaptive load shedding, request record/replay, dan audit event stream."
---

Kebijakan tata kelola, pengamanan trafik, dan operasional yang disertakan dalam paket inti gateway. Semua kebijakan nonaktif secara bawaan.

## Apa yang Dilakukannya (What it does)

Paket fitur menambahkan kebijakan tata kelola dan keselamatan operasional tanpa memerlukan dependensi pihak ketiga:

### Tata Kelola Trafik & Ketahanan
- **CORS**: Menangani permintaan preflight (`OPTIONS`) dan menyisipkan header standar `Access-Control-*`. Permintaan preflight dieksekusi sebelum autentikasi dan rate limiting.
- **W3C Trace Context**: Membaca header `traceparent` masuk untuk meneruskan jejak terdistribusi atau menghasilkan ID trace/span baru, menyediakannya ke plugin melalui `ctx.state`.
- **Idempotency Keys**: Mencegah eksekusi ganda pada metode HTTP tidak aman (`POST`, `PATCH`, `PUT`) dengan menyimpan respons berdasarkan header `Idempotency-Key`. Pengulangan permintaan mengembalikan `idempotent-replay: true`.
- **Adaptive Load Shedding**: Menyesuaikan batas konkurensi secara dinamis berdasarkan observasi latensi P95. Kondisi kelebihan beban langsung mengembalikan HTTP 503 Problem Details.
- **Traffic Shadowing**: Meneruskan salinan sampel trafik produksi secara asinkron ke upstream pengujian (`x-shadow: true`) tanpa memengaruhi latensi respons klien.
- **Sticky Sessions**: Mengikat pemanggil ke instans upstream tertentu melalui hashing cookie atau header.

### Keamanan & Tata Kelola Identitas
- **Outbound Secret Masking**: Memeriksa body respons upstream untuk mendeteksi JWT, kunci privat PEM, dan kunci sensitif umum (`password`, `token`, `secret`), menggantinya dengan teks tersamarkan.
- **Verifikasi HMAC Masuk**: Memvalidasi tanda tangan kriptografis dari body request sebelum perutean dilakukan.
- **Kuota Harian**: Menerapkan batas request bergulir 24 jam per identitas konsumen di samping rate limit per menit.
- **SSRF Guard**: Membatasi penerusan proxy ke alamat IP privat, loopback, atau metadata cloud kecuali jika dimasukkan ke daftar izin (allowlist).
- **Security Headers**: Menyisipkan header keamanan standar (HSTS, CSP, X-Frame-Options) dan menghapus banner identitas server internal.

### Operasional & Diagnostik
- **Admin Control Plane**: Menyediakan endpoint introspeksi terlindungi (`/__admin/state`) dan mekanisme pembersihan cache (`POST /__admin/cache/purge`).
- **Pembuatan Rute OpenAPI**: Mengimpor manifes rute langsung dari dokumen spesifikasi OpenAPI 3.1, mendukung sintaks path `{param}` dan `:param`.
- **Request Record & Replay**: Menyimpan request dan response yang lewat ke memori lokal untuk mempermudah reproduksi insiden dan pembuatan pengujian regresi (`x-replay-id`).
- **Audit Event Stream**: Memancarkan catatan audit berformat NDJSON ke stdout dengan penyensoran otomatis terhadap data kredensial.

## Konfigurasi (Configuration)

Kebijakan dalam feature pack diaktifkan melalui `gateway.config.json`:

| Kebijakan | Blok Konfigurasi | Nilai Bawaan | Pengaturan Kunci |
|---|---|---|---|
| CORS | `cors` | Nonaktif | `allowOrigins`, `allowMethods`, `allowHeaders`, `allowCredentials`, `maxAgeSeconds`. |
| Trace Context | `traceContext` | Nonaktif | `enabled: true`. |
| Idempotency | `idempotency` | Nonaktif | `ttlMs: 86400000`, `maxEntries: 10000`. |
| Secret Masking | `secretMask` | Nonaktif | `replacement: "[REDACTED]"`. |
| Load Shedding | `loadShedding` | Nonaktif | `min: 16`, `max: 1024`, `targetP95Ms: 250`. |
| Shadowing | `shadow` | Nonaktif | `target: "http://127.0.0.1:9999"`, `sampleRate: 0.1`. |
| Inbound HMAC | `verifyInboundHmac` | Nonaktif | `secret: "${WEBHOOK_SECRET}"`. |
| SSRF Guard | `ssrfGuard` | Nonaktif | `allowlist: ["internal.example.com"]`. |
| Security Headers | `securityHeaders` | Nonaktif | `hsts: "max-age=31536000"`, `stripServer: true`. |
| Sticky Sessions | `stickySession` | Nonaktif | `upstreams: ["a", "b"]`. |
| Admin API | `admin` | Nonaktif | `basePath: "/__admin"`, `requireAuth: true`. |
| Record & Replay | `record`, `replay` | Nonaktif | `maxEntries: 1000`, `maxAgeMs: 3600000`. |
| Audit Stream | `audit` | Nonaktif | `sampleRate: 1`, `includeHeaders: false`. |

```json
{
  "cors": {
    "enabled": true,
    "allowOrigins": ["https://app.example.com"],
    "allowMethods": ["GET", "POST"],
    "allowHeaders": ["content-type", "authorization"],
    "allowCredentials": false,
    "maxAgeSeconds": 600
  },
  "traceContext": { "enabled": true },
  "idempotency": { "enabled": true, "ttlMs": 86400000, "maxEntries": 10000 },
  "secretMask": { "enabled": true, "replacement": "[REDACTED]" },
  "loadShedding": { "enabled": true, "min": 16, "max": 1024, "targetP95Ms": 250 }
}
```

## Interaksi Pipeline (Interactions)

Kebijakan dieksekusi secara berurutan dan deterministik di dalam pipeline tanpa terpengaruh urutan deklarasi dalam file konfigurasi:

1. **Load Shedding**: Memeriksa kapasitas beban konkurensi; langsung menolak koneksi dengan status 503 jika overloaded.
2. **CORS Preflight**: Menjawab permintaan `OPTIONS` seketika tanpa memicu overhead autentikasi.
3. **Trace Context**: Membaca `traceparent` masuk atau membuat identifier trace baru di `ctx.state`.
4. **Idempotency**: Memeriksa apakah `Idempotency-Key` cocok dengan entri hasil cache yang sudah tersimpan.
5. **SSRF Guard**: Memvalidasi alamat IP target sebelum request jaringan dikirim ke luar.
6. **Inbound HMAC**: Memvalidasi tanda tangan kriptografis dari body request.
7. **Sticky Sessions & Shadowing**: Memilih instans upstream afinitas dan mendaftarkan proses traffic shadowing asinkron.
8. **Security Headers & Auth**: Menerapkan kebijakan TLS serta mengeksekusi autentikasi dan kuota pemanggil.
9. **Audit, Record & Replay**: Memancarkan log audit dan menyimpan atau memutar ulang respons request.
10. **Outbound Secret Masking**: Mengintersepsi body respons upstream, menyamarkan data rahasia sebelum mengirimkan byte ke klien.

## Tradeoff dan Mode Kegagalan (Tradeoffs and failure modes)

- **Isolasi Penyimpanan di Memori**: Cache idempotensi, rekaman request, dan tabel sesi afinitas disimpan di memori proses lokal. Dalam lingkungan multi-node terdistribusi, request harus diarahkan ke node gateway yang sama atau menggunakan session stickiness di load balancer eksternal.
- **Osilasi Adaptive Load Shedding**: Menentukan `targetP95Ms` terlalu dekat dengan latensi normal upstream dapat menimbulkan siklus penolakan request yang tidak stabil; pastikan tersedia margin yang memadai antara target P95 dan latensi normal.
- **Beban Pemrosesan Secret Masking**: Memindai respons untuk mendeteksi JWT dan kunci JSON memerlukan parsing data teks. Penyensoran ini secara sengaja dilewati untuk stream biner (`application/octet-stream`, gambar) guna mencegah pemborosan memori.
- **Beban Tambahan dari Shadowing**: Trafik yang disalin menghasilkan beban request tambahan pada lingkungan upstream pengujian; pembatasan rasio sampling (`sampleRate`) dan batas konkurensi aktif melindungi server pengujian dari lonjakan beban.
