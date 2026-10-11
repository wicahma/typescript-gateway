---
title: "Panduan Memulai"
description: "Dari nol hingga gateway berjalan dalam dua menit. Tanpa membutuhkan pemahaman framework."
---

Di akhir panduan ini, Anda akan memiliki gateway yang berjalan dan meneruskan permintaan HTTP ke layanan lokal dengan header kustom.

## Prasyarat

Pastikan lingkungan pengembangan Anda memenuhi persyaratan berikut sebelum memulai:

| Kebutuhan | Versi Didukung | Perintah Verifikasi |
| --- | --- | --- |
| Node.js | 20.0.0 atau lebih tinggi | `node -v` |
| npm | 9.0.0 atau lebih tinggi | `npm -v` |
| Layanan HTTP | Backend HTTP lokal apa pun | `python3 -m http.server 3000` |

## Langkah 1: Pasang dan Inisialisasi

Buat direktori baru untuk proyek gateway Anda, inisialisasi paket, dan pasang file awal:

```bash
mkdir my-gateway && cd my-gateway
npm init -y
npm install typescript-gateway tsx
npx tsgate init .
```

Hasil yang diharapkan:

```text
Created gateway project in /path/to/my-gateway
  - package.json
  - gateway.config.json
  - plugins/hello.ts
  - AGENTS.md
  - CLAUDE.md
```

Inisialisasi ini menghasilkan file `gateway.config.json` untuk konfigurasi routing dan `plugins/hello.ts` untuk hook lifecycle.

Perintah ini juga menulis `AGENTS.md` dan `CLAUDE.md` untuk agen pengkode AI. Aturannya berada dalam blok terkelola `<!-- BEGIN:tsgate-agent-rules -->` yang mengarahkan agen ke dokumentasi sesuai versi yang dipaketkan di `node_modules/typescript-gateway/dist/docs/index.md`. `tsgate start` menulis ulang blok tersebut; teks yang Anda tambahkan di luarnya tetap dipertahankan.

## Langkah 2: Konfigurasi Route dan Upstream

Buka file `gateway.config.json` dan periksa konfigurasi routing bawaan:

```json
{
  "server": {
    "port": 8088
  },
  "routes": [
    {
      "method": "GET",
      "path": "/api/*"
    }
  ],
  "upstreams": [
    {
      "id": "backend",
      "host": "localhost",
      "port": 3000
    }
  ]
}
```

Konfigurasi ini menentukan parameter berikut:

| Bagian | Pengaturan | Tujuan |
| --- | --- | --- |
| `server.port` | `8088` | Port tempat gateway mendengarkan permintaan masuk. |
| `routes[0].path` | `/api/*` | Mencocokkan permintaan GET yang diawali dengan `/api/`. |
| `upstreams[0]` | `localhost:3000` | Alamat layanan HTTP target. |

Validasi file konfigurasi tersebut:

```bash
npx tsgate validate
```

Hasil yang diharapkan:

```text
OK: configuration is valid (1 routes, 1 upstreams)
```

## Langkah 3: Jalankan dan Verifikasi Gateway

Jalankan layanan HTTP lokal di terminal terpisah:

```bash
python3 -m http.server 3000
```

Hasil yang diharapkan:

```text
Serving HTTP on 0.0.0.0 port 3000 (http://0.0.0.0:3000/) ...
```

Di direktori proyek Anda, jalankan gateway:

```bash
npx tsgate start
```

Hasil yang diharapkan:

```text
Gateway started on http://0.0.0.0:8088
```

Kirim permintaan uji melalui proxy:

```bash
curl -i http://localhost:8088/api/
```

Hasil yang diharapkan:

```text
HTTP/1.1 200 OK
x-hello: from tsgate plugin
Content-Type: text/html
Content-Length: ...
```

Permintaan berhasil diteruskan dan menyertakan header respons `x-hello` dari `plugins/hello.ts`.

## Langkah Selanjutnya

Untuk mempelajari cara mengatur batas waktu timeout, menambahkan variabel lingkungan, dan mengonfigurasi banyak route, baca [Konfigurasi](/id/docs/guides/configuration/).
