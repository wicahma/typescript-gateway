---
title: "Panduan Penggunaan"
description: "Resep praktis: proxying, auth, rate limiting, caching, load balancing, dan plugin kustom."
---

Di akhir panduan ini, Anda akan memiliki resep praktis untuk autentikasi, pembatasan laju (rate limiting), caching, dan load balancing pada gateway Anda.

## Ikhtisar Resep

Resep berikut merepresentasikan pola penerapan standar produksi:

| Resep | Area Fitur | Bagian Konfigurasi |
| --- | --- | --- |
| Reverse Proxy Dasar | Routing | `routes`, `upstreams` |
| Autentikasi JWT | Identitas | `auth` |
| Kunci API & Kuota | Kontrol Trafik | `apiKeys` |
| Caching Respons | Performa | `responseCache` |
| Injeksi Kredensial | Keamanan | `upstreamCredentials` |
| Load Balancing | Kontrol Trafik | `upstreams[].weight` |

## Langkah 1: Siapkan Reverse Proxy

Konfigurasikan proxy dasar yang meneruskan permintaan dari `/api/*` ke layanan upstream sambil menyediakan health check lokal:

```json
{
  "server": { "port": 8088, "host": "0.0.0.0" },
  "routes": [
    { "method": "GET", "path": "/api/:id", "priority": 0 },
    { "method": "POST", "path": "/api/orders", "priority": 0 }
  ],
  "upstreams": [
    {
      "id": "backend",
      "protocol": "http",
      "host": "127.0.0.1",
      "port": 8080,
      "basePath": "",
      "poolSize": 10,
      "timeout": 30000,
      "healthCheck": {
        "enabled": true,
        "path": "/health",
        "interval": 30000,
        "timeout": 5000,
        "expectedStatus": 200
      }
    }
  ]
}
```

Jalankan gateway dan periksa routing:

```bash
npx tsgate start
```

Hasil yang diharapkan:

```text
Gateway started on http://0.0.0.0:8088
```

Periksa endpoint health check:

```bash
curl -s http://localhost:8088/health
```

Hasil yang diharapkan:

```json
{"status":"healthy","upstreams":[{"id":"backend","status":"healthy"}]}
```

## Langkah 2: Tambahkan Autentikasi dan Rate Limiting

Amankan layanan upstream dengan validasi token JWT atau kunci API berserta kuota per konsumen.

### Resep Autentikasi JWT

Tambahkan blok `auth` untuk memverifikasi token menggunakan kunci kriptografi bawaan:

```json
{
  "auth": {
    "enabled": true,
    "issuer": "https://id.example.com",
    "audience": "my-api",
    "leewaySeconds": 30,
    "publicRoutes": ["/health", "/metrics", "/auth/login"],
    "jwks": {
      "keys": [
        { "kty": "RSA", "n": "...", "e": "AQAB", "kid": "2026-01" }
      ]
    }
  }
}
```

Verifikasi penolakan tanpa token:

```bash
curl -i http://localhost:8088/api/profile
```

Hasil yang diharapkan:

```text
HTTP/1.1 401 Unauthorized
content-type: application/problem+json

{"type":"about:blank","title":"Unauthorized","status":401,"detail":"Missing or invalid token"}
```

### Resep Kuota Kunci API

Tambahkan batasan laju per konsumen menggunakan `apiKeys`:

```json
{
  "apiKeys": {
    "enabled": true,
    "headerName": "x-api-key",
    "cacheTtlSeconds": 60,
    "cacheMaxEntries": 1000,
    "publicRoutes": ["/health"],
    "consumers": [
      {
        "consumerId": "mobile-app",
        "plan": "free",
        "rateLimit": 100,
        "keys": [{ "key": "ak_live_mobile_123" }]
      }
    ]
  }
}
```

## Langkah 3: Aktifkan Caching dan Kredensial Upstream

Tingkatkan latensi dengan in-memory caching dan tandatangani permintaan keluar secara aman.

### Resep Caching Respons

Tambahkan blok konfigurasi `responseCache`:

```json
{
  "responseCache": {
    "enabled": true,
    "ttlSeconds": 60,
    "maxSize": 5000
  }
}
```

Verifikasi status cache:

```bash
curl -i http://localhost:8088/api/items
```

Hasil yang diharapkan:

```text
HTTP/1.1 200 OK
x-cache: MISS
```

Mengirim permintaan yang sama segera mengembalikan:

```text
HTTP/1.1 200 OK
x-cache: HIT
```

### Resep Injeksi Kredensial dan Penandatanganan HMAC

Sematkan header internal dan tanda tangan HMAC:

```json
{
  "upstreamCredentials": {
    "enabled": true,
    "credentials": [
      {
        "name": "billing-service",
        "headers": { "x-internal-token": "secret-token" },
        "hmac": {
          "secret": "${BILLING_HMAC_SECRET}",
          "keyId": "gw-1",
          "headerNamespace": "x-hmac"
        }
      }
    ],
    "injection": { "credentialName": "billing-service", "publicRoutes": ["/health"] },
    "signing": { "credentialName": "billing-service", "publicRoutes": ["/health"] }
  }
}
```

## Langkah 4: Konfigurasi Load Balancing

Distribusikan trafik ke banyak backend menggunakan bobot upstream:

```json
{
  "upstreams": [
    {
      "id": "api-primary",
      "host": "10.0.0.1",
      "port": 8080,
      "weight": 3,
      "healthCheck": { "enabled": true, "path": "/health" }
    },
    {
      "id": "api-secondary",
      "host": "10.0.0.2",
      "port": 8080,
      "weight": 1,
      "healthCheck": { "enabled": true, "path": "/health" }
    }
  ]
}
```

Gateway menyeimbangkan trafik dengan rasio 3:1 dan mengabaikan instance yang gagal dalam pemeriksaan kesehatan berkala.

## Langkah Selanjutnya

Untuk memeriksa mekanisme internal dari circuit breaker, perutean radix, dan kebijakan pipeline, telusuri [Pendalaman](/id/docs/deep-dive/).
