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

## Seksi terkait

- [Pendalaman](/id/docs/deep-dive/) menjelaskan perilaku dan konfigurasi; Referensi menjelaskan struktur dan tanda tangan.
- [Panduan](/id/docs/guides/) adalah tempat mulai kalau kamu hanya ingin menjalankan gateway.
