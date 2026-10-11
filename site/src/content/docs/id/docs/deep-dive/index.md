---
title: "Pendalaman"
description: "Bagaimana setiap fitur sebenarnya berperilaku: konfigurasi, tradeoff, interaksi, dan mode kegagalan."
---

Panduan menunjukkan apa yang harus Anda ketik. Pendalaman menjelaskan apa yang dilakukan gateway terhadapnya. Setiap halaman di sini membahas satu kelompok fitur secara menyeluruh: opsi konfigurasi, nilai bawaan dan alasan pemilihannya, interaksinya dengan pipeline request, serta apa yang terjadi saat sistem mengalami kegagalan.

## Untuk siapa bagian ini

- Pengembang yang sudah menjalankan gateway dan perlu menyesuaikannya (tuning), bukan sekadar memulainya.
- Engineer yang merancang sistem produksi: retry, timeout, circuit breaker, caching, autentikasi, observabilitas.
- Peninjau yang perlu menilai apakah suatu fitur cocok dengan beban kerja sebelum menerapkannya.

## Struktur: Apa yang Dilakukannya (What it does)

Setiap halaman menjelaskan perilaku subsistem dalam bahasa sederhana, menguraikan tanggung jawab arsitektural, struktur data, dan jaminan dasar.

## Struktur: Konfigurasi (Configuration)

Setiap halaman merinci setiap opsi konfigurasi, tipe datanya, nilai bawaan, dan dampak langsungnya pada runtime.

## Struktur: Interaksi Pipeline (Interactions)

Setiap halaman mendetailkan bagaimana fitur menyusun diri dengan sisa pipeline, mengidentifikasi posisi hook dan interaksi komunikasi upstream.

## Struktur: Tradeoff dan Mode Kegagalan (Tradeoffs and failure modes)

Setiap halaman mendeskripsikan biaya operasional pengaktifan fitur, overhead memori, dan perilakunya saat terjadi degradasi upstream atau kehabisan sumber daya.

## Topik Pembahasan

| Topik | Deskripsi |
| --- | --- |
| [Arsitektur](/id/docs/deep-dive/architecture/) | Siklus hidup permintaan, soket upstream, model proses |
| [Perutean Inti & Proksi](/id/docs/deep-dive/core-routing/) | Router radix, connection pooling, penerusan proksi |
| [Ketahanan (Resilience)](/id/docs/deep-dive/resilience/) | Circuit breaker, retry otomatis, pemeriksaan kesehatan |
| [Kontrol Trafik](/id/docs/deep-dive/traffic-control/) | Rate limiting, cache respons, penyeimbangan beban |
| [Penanganan Payload](/id/docs/deep-dive/payload/) | Parsing body, streaming, kompresi gzip & brotli |
| [Observabilitas](/id/docs/deep-dive/observability/) | Metrik Prometheus, log terstruktur, dasbor langsung |
| [Operasional](/id/docs/deep-dive/operations/) | Validasi konfigurasi, hook plugin, auto-tuning |
| [Identitas & Keamanan](/id/docs/deep-dive/identity-security/) | Validasi JWT, API key, RFC 7807 problem details |
| [Matriks Fitur](/id/docs/deep-dive/features/) | Inventaris fitur dan batas performa |
| [Paket Fitur Tambahan](/id/docs/deep-dive/feature-pack/) | Ekstensi lanjutan dan konfigurasi penerapan |

## Hubungannya dengan bagian lain

- Mulai dari [Panduan](/id/docs/guides/) jika Anda belum pernah menjalankan gateway.
- Kunjungi [Referensi](/id/docs/reference/) saat Anda membutuhkan tanda tangan fungsi, tipe kembalian, atau file implementasi dari apa yang Anda baca di sini.
