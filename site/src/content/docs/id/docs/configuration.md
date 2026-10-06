---
title: "Referensi Konfigurasi"
description: "Konfigurasi JSON deklaratif dengan interpolasi environment variable."
order: 3
section: "Configuration"
track: "guide"
---

Gateway dikonfigurasi lewat file JSON deklaratif (default: `config/gateway.config.json`). Semua field string mendukung interpolasi environment variable.

## Contoh Konfigurasi

```json
{
  "version": "1.0.0",
  "environment": "production",
  "server": {
    "port": 3000,
    "host": "0.0.0.0",
    "keepAlive": true,
    "keepAliveTimeout": 65000,
    "requestTimeout": 30000,
    "maxHeaderSize": 16384,
    "maxBodySize": 10485760
  },
  "routes": [
    {
      "method": "GET",
      "path": "/api/:id",
      "priority": 0
    }
  ],
  "upstreams": [
    {
      "id": "backend-service",
      "protocol": "http",
      "host": "localhost",
      "port": 8080,
      "basePath": "",
      "poolSize": 10,
      "timeout": 30000,
      "healthCheck": {
        "enabled": true,
        "interval": 30000,
        "timeout": 5000,
        "path": "/health",
        "expectedStatus": 200
      }
    }
  ],
  "performance": {
    "workerCount": 0,
    "contextPoolSize": 1000,
    "bufferPoolSize": 1000,
    "responsePoolSize": 1000,
    "enablePooling": true
  }
}
```

## Interpolasi Environment Variable

Kamu bisa menyisipkan environment variable sistem langsung ke dalam string pakai `${VAR_NAME}` atau sintaks fallback `${VAR_NAME:-defaultValue}`:

```json
{
  "server": {
    "host": "${GATEWAY_HOST:-0.0.0.0}",
    "port": "${GATEWAY_PORT:-3000}"
  },
  "upstreams": [
    {
      "host": "${AUTH_SERVICE_HOST:-auth.internal}",
      "port": "${AUTH_SERVICE_PORT:-8080}"
    }
  ]
}
```

## Bagian Konfigurasi

### `server`
- `port`: Nomor port (ditimpa oleh `process.env.PORT` kalau ada).
- `host`: Alamat bind interface (ditimpa oleh `process.env.HOST`).
- `keepAlive`: Aktifkan pemakaian ulang koneksi HTTP Keep-Alive.
- `keepAliveTimeout`: Timeout (dalam ms) sebelum socket idle ditutup.
- `maxBodySize`: Ukuran payload request maksimal dalam byte (default: 10MB).

### `routes`
- `method`: HTTP Verb (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`).
- `path`: Pola URL. Mendukung parameter dinamis (`/api/:id`).
- `priority`: Urutan evaluasi.

### `upstreams`
- `id`: Key unik untuk cluster backend.
- `protocol`: `http` atau `https`.
- `host`: IP atau hostname backend.
- `port`: Port tujuan backend.
- `poolSize`: Jumlah koneksi persisten maksimal yang dipertahankan.
- `healthCheck`: Konfigurasi health probe aktif di background.

### `performance`
- `contextPoolSize`: Instance request context yang dialokasikan di awal.
- `enablePooling`: Nyalakan/matikan daur ulang memory pool.
