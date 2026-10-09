---
title: "Feature Pack"
description: "CORS, W3C trace context, idempotency key, masking secret outbound, dan adaptive load shedding."
order: 14
section: "Guide"
track: "reference"
---


Lima policy governance dan keamanan yang sudah ada di gateway inti. Semuanya
nonaktif secara default — aktifkan dengan menambah block di
`gateway.config.json`.

## CORS

Menjawab request preflight (`OPTIONS`) dan menambah header `Access-Control-*`
ke response asli.

```json
{
  "cors": {
    "enabled": true,
    "allowOrigins": ["https://app.example.com"],
    "allowMethods": ["GET", "POST"],
    "allowHeaders": ["content-type", "authorization"],
    "allowCredentials": false,
    "maxAgeSeconds": 600
  }
}
```

- `allowOrigins: ["*"]` merefleksikan origin apa pun (dan mengembalikan origin
  request saat `allowCredentials` true, karena `*` ilegal bersama credentials).
- Preflight dari origin yang tidak diizinkan ditolak dengan `403` problem+json.
- Preflight dijawab **sebelum** auth dan rate limit, jadi tidak butuh key.

## W3C trace context

Membaca header `traceparent` yang masuk (melanjutkan trace) atau memulai trace
baru, lalu mengembalikannya di response agar caller bisa mengorelasikan.

```json
{ "traceContext": { "enabled": true } }
```

Trace id dan span id juga tersedia untuk plugin sebagai `ctx.state.traceId`,
`ctx.state.spanId`, dan `ctx.state.parentSpanId`.

## Idempotency key

Mendeduplikasi request tidak aman. Client mengirim header `Idempotency-Key` pada
`POST`/`PATCH`; request pertama dijalankan dan response-nya disimpan, lalu
request ulang dengan key sama akan memutar ulang response tersebut
(`idempotent-replay: true`).

```json
{ "idempotency": { "enabled": true, "ttlMs": 86400000, "maxEntries": 10000 } }
```

- Key sama, body beda → `400` (key dipakai ulang untuk request berbeda).
- Key sama saat request pertama masih in-flight → `409 Conflict`.
- Store bersifat per-proses dan dibatasi; tidak dibagi antar replica.

## Masking secret outbound

Meredaksi secret dari response upstream sebelum sampai ke client. Mendeteksi
JWT, private key PEM, dan field JSON bernama `secret`/`token`/`password`/
`api_key`.

```json
{ "secretMask": { "enabled": true, "replacement": "[REDACTED]" } }
```

Response yang dimasking membawa `x-secret-masked: true` dan
`x-masked-request-id`. Hanya body text dan JSON yang diperiksa; `content-length`
dikoreksi dan `transfer-encoding` dihapus saat body berubah.

## Adaptive load shedding

Membuang beban saat proses jenuh, melindunginya dari kolaps. Batas konkurensi
beradaptasi dengan p95 latency yang teramati: menyusut saat latency tinggi dan
bertambah saat latency rendah, dalam batas yang dikonfigurasi.

```json
{ "loadShedding": { "enabled": true, "min": 16, "max": 1024, "targetP95Ms": 250 } }
```

Saat batas tercapai, request baru mendapat `503` problem+json
(`Server at capacity, retry shortly`). Slot dilepas saat response selesai,
termasuk ketika policy lain men-short-circuit request.

## Urutan

Policy berjalan dengan urutan tetap terlepas dari urutan di config: load
shedding → CORS → trace context → idempotency → (auth, API key, cache, upstream
credential). Secret masking berjalan di jalur outbound.


## Tambahan Milestone B

### Traffic shadowing

Memirror sebagian trafik live (sampled) ke upstream shadow untuk validasi
aman. Fire-and-forget: shadow yang lambat/gagal tidak memengaruhi client.

```json
{ "shadow": { "enabled": true, "target": "http://127.0.0.1:9999", "sampleRate": 0.1 } }
```

Request mirror membawa `x-shadow: true`; jumlah mirror in-flight dibatasi
`maxInflight`.

### Verifikasi HMAC inbound

Memverifikasi signature webhook atas body request mentah sebelum diterima.

```json
{ "verifyInboundHmac": { "enabled": true, "secret": "${WEBHOOK_SECRET}" } }
```

Menolak dengan `401` problem+json saat signature hilang, salah, atau kedaluwarsa.

### Kuota harian per consumer

Menambah budget request harian di atas rate limit per menit; `429` membawa
counter harian.

```json
{ "apiKeys": { "enabled": true, "consumers": [
  { "consumerId": "c1", "plan": "pro", "rateLimit": 600, "dailyLimit": 100000, "keys": [{ "key": "..." }] }
] } }
```

### SSRF guard

Menolak request yang target host-nya alamat private/loopback/link-local (atau
`localhost`/`.internal`), kecuali di-allowlist.

```json
{ "ssrfGuard": { "enabled": true, "allowlist": ["internal.example.com"] } }
```

### Security headers

Menambah header hardening dan menghapus banner server dari response.

```json
{ "securityHeaders": { "enabled": true, "hsts": "max-age=31536000", "stripServer": true } }
```

### Sticky session

Mem-pin caller (via header atau cookie) ke satu upstream untuk lokalitas cache.

```json
{ "stickySession": { "enabled": true, "upstreams": ["a", "b", "c"] } }
```

### Admin control plane

State operasional read-only dan purge cache, digerbangi identitas yang sama
(`requireAuth`).

```json
{ "admin": { "enabled": true, "basePath": "/__admin", "requireAuth": true } }
```

- `GET /__admin/state` — uptime, state breaker, stat cache, info load-shed,
  nama policy aktif.
- `POST /__admin/cache/purge` — body `{ "pattern": "<regex>" }`; mengembalikan
  jumlah entri yang dipurge.

### Sintaks route OpenAPI `{param}`

Route menerima `{id}` (gaya OpenAPI) maupun `:id`, plus regex group
(`/orders/:orderId(\d+)`).

```json
{ "routes": [{ "method": "GET", "path": "/users/{id}" }] }
```

### Dokumen OpenAPI sebagai sumber routing

Deklarasikan seluruh route dari dokumen OpenAPI 3.1, bukan daftar manual.

```json
{ "openapi": { "enabled": true, "basePath": "/api", "spec": { "openapi": "3.1.0", "paths": { "/users/{id}": { "get": {} } } } } }
```
