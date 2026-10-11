---
title: "Referensi Konfigurasi"
description: "Konfigurasi JSON deklaratif dengan interpolasi environment variable."
---

Di akhir panduan ini, Anda akan memiliki file gateway.config.json tervalidasi yang disesuaikan untuk lingkungan produksi atau lokal Anda.

## Ikhtisar

Gateway membaca pengaturannya dari file JSON deklaratif (`gateway.config.json`). Setiap field string mendukung interpolasi variabel lingkungan dengan nilai cadangan (fallback).

| Bagian Tingkat Atas | Tujuan | Wajib |
| --- | --- | --- |
| `server` | Listener HTTP, port, batas waktu, dan batas ukuran body. | Ya |
| `routes` | Pola URL masuk, metode HTTP, dan prioritas. | Ya |
| `upstreams` | Layanan tujuan, pool koneksi, dan health check. | Ya |
| `performance` | Jumlah worker dan alokasi pool memori. | Tidak |

## Langkah 1: Buat File Konfigurasi Dasar

Buat file `gateway.config.json` di direktori utama proyek Anda:

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

## Langkah 2: Konfigurasi Opsi Utama

Sesuaikan opsi utama berdasarkan arsitektur jaringan Anda:

| Kolom | Tipe | Nilai Bawaan | Deskripsi |
| --- | --- | --- | --- |
| `server.port` | number | `3000` | Port untuk menerima permintaan HTTP. |
| `server.keepAlive` | boolean | `true` | Menggunakan ulang koneksi TCP antara klien dan gateway. |
| `server.maxBodySize` | number | `10485760` | Ukuran payload permintaan maksimum dalam byte (10 MB). |
| `routes[].path` | string | — | Pola route, mendukung token `:param`. |
| `upstreams[].poolSize` | number | `10` | Jumlah koneksi pool soket maksimum per upstream. |

## Langkah 3: Interpolasi Variabel Lingkungan

Gantikan string statis dengan variabel lingkungan bila diperlukan. Gunakan format `${VAR_NAME}` atau sintaks fallback `${VAR_NAME:-defaultValue}`:

```json
{
  "server": {
    "host": "${GATEWAY_HOST:-0.0.0.0}",
    "port": "${GATEWAY_PORT:-3000}"
  },
  "upstreams": [
    {
      "id": "backend-service",
      "host": "${BACKEND_HOST:-localhost}",
      "port": "${BACKEND_PORT:-8080}"
    }
  ]
}
```

Gateway melakukan substitusi variabel sebelum melakukan validasi skema JSON.

## Langkah 4: Validasi File Konfigurasi

Jalankan perintah validasi konfigurasi dari direktori proyek Anda:

```bash
npx tsgate validate
```

Hasil yang diharapkan:

```text
OK: configuration is valid (1 routes, 1 upstreams)
```

Jika terjadi kesalahan, validator akan menunjukkan lokasi field dan tipe yang diharapkan:

```bash
GATEWAY_PORT=abc npx tsgate validate
```

Hasil yang diharapkan:

```text
Error: server.port must be an integer, received NaN
```

## Langkah Selanjutnya

Untuk mengonfigurasi autentikasi, rate limiting, dan caching respons untuk route Anda, lanjutkan ke [Panduan Penggunaan](/id/docs/guides/usage/).
