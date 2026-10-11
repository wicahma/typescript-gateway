---
title: "Referensi"
description: "Setiap simbol yang di-export gateway, dikelompokkan per modul, lengkap dengan tanda tangan dan lokasi sumber."
---

Referensi adalah peta codebase. Satu halaman per modul di bawah `src/`, memuat setiap class, function, konstanta, interface, dan type yang di-export, beserta tanda tangannya, kegunaannya, dan lokasinya. Seksi ini ditulis untuk orang yang membaca, memperluas, atau me-review internal gateway.

## Untuk siapa seksi ini

- Kontributor yang menambah fitur, plugin, atau policy.
- Reviewer yang memeriksa apakah sebuah internal dipakai dengan benar di tempat lain.
- Siapa pun yang mengintegrasikan gateway sebagai library, bukan menjalankannya sebagai proses.

## Yang bisa kamu lakukan

- Menemukan tanda tangan persis apa pun yang di-export dari `src/`.
- Melacak sebuah simbol kembali ke filenya dan melihat apa yang ia bergantung padanya.
- Memahami batas antar modul — apa yang pantas masuk `core`, `pipeline`, `identity`, dan seterusnya — sebelum menambah kode.

## Cara membacanya

Setiap halaman mencakup satu modul. Ia dibuka dengan satu paragraf ringkas tentang tanggung jawab modul itu, lalu tabel berisi setiap export, lalu catatan untuk yang tidak jelas dengan sendirinya. Tanda tangan disalin dari sumber; kalau di sini berbeda dengan sumber, sumber yang menang — buka issue.

Halaman diurutkan menurut dependensi, bukan alfabetis. [Entrypoints](/id/docs/reference/entrypoints/) dan [Types](/id/docs/reference/types/) adalah titik mulai terbaik karena semua yang lain bergantung padanya.

## Modul

| Modul | Deskripsi |
| --- | --- |
| [Titik Masuk](/id/docs/reference/entrypoints/) | Bootstrap gateway dan ekspor tingkat atas |
| [Mesin Inti](/id/docs/reference/core/) | Server HTTP, router radix, connection pool, cache |
| [Pipeline](/id/docs/reference/pipeline/) | Kebijakan middleware dan rantai eksekusi |
| [Plugin](/id/docs/reference/plugins/) | Hook siklus hidup plugin dan handler bawaan |
| [Identitas](/id/docs/reference/identity/) | Kriptografi API key dan manajemen konsumen |
| [Konfigurasi](/id/docs/reference/config/) | Validasi skema dan auto-tuning |
| [Tipe](/id/docs/reference/types/) | Antarmuka inti dan tipe kontrak |
| [Utilitas](/id/docs/reference/utils/) | Logger, object pool, dan buffer metrik |
| [Pemrofilan](/id/docs/reference/profiling/) | Pemrofil CPU V8 dan heap snapshot |
| [Pemantauan](/id/docs/reference/monitoring/) | Pemantau performa dan peringatan |
| [Observabilitas](/id/docs/reference/observability/) | Format eksposisi Prometheus |
| [Admin](/id/docs/reference/admin/) | Endpoint manajemen administratif |
| [Pengujian](/id/docs/reference/testing/) | Rangkaian tes dan harness tolak ukur |

## Seksi terkait

- [Pendalaman](/id/docs/deep-dive/) menjelaskan perilaku dan konfigurasi; Referensi menjelaskan struktur dan tanda tangan.
- [Panduan](/id/docs/guides/) adalah tempat mulai kalau kamu hanya ingin menjalankan gateway.
