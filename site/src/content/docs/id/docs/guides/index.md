---
title: "Panduan"
description: "Mulai di sini: pasang gateway, arahkan ke upstream, dan jalankan konfigurasi yang bekerja dalam hitungan menit."
---

Seksi Panduan ada karena cara tercepat menilai sebuah gateway adalah menjalankannya. Setiap halaman di sini berdiri sendiri: kamu bisa membaca salah satu lebih dulu, dan tidak ada satu pun yang menuntut kamu paham cara kerja internalnya.

## Untuk siapa seksi ini

- Developer yang sudah punya layanan HTTP dan ingin menaruh gateway di depannya.
- Tim yang membandingkan TypeScript Gateway dengan nginx, Envoy, atau Kong.
- Siapa pun yang butuh `gateway.json` yang bekerja hari ini, bukan dokumen desain.

Kalau kamu belum pernah menjalankan gateway ini, baca halamannya berurutan. Kalau sudah jalan dan hanya butuh resep tertentu, langsung ke [Usage](/id/docs/guides/usage/).

## Yang bisa kamu lakukan

| Halaman | Setelah membacanya kamu bisa |
| --- | --- |
| [Getting Started](/id/docs/guides/getting-started/) | Memasang gateway dan mem-proxy request pertama. |
| [Configuration](/id/docs/guides/configuration/) | Menulis `gateway.json` dan tahu bagaimana ia divalidasi. |
| [Usage](/id/docs/guides/usage/) | Menyalin resep yang bekerja untuk auth, rate limit, caching, dan load balancing. |

## Yang sengaja tidak dibahas di sini

Panduan menunjukkan jalur terpendek menuju hasil. Ia tidak menjelaskan *mengapa* sebuah default bernilai demikian, bagaimana urutan request pipeline, atau internal mana yang tersentuh sebuah fitur. Ketika sebuah resep sudah tidak cukup, lanjut ke [Pendalaman](/id/docs/deep-dive/). Ketika kamu butuh tanda tangan persis sebuah class atau function, buka [Referensi](/id/docs/reference/).
