---
title: "Titik Masuk (Entrypoints)"
description: "Titik masuk API publik gateway dan ekspor tingkat teratas."
---

Modul titik masuk menyediakan antarmuka dasar dan inisialisasi untuk TypeScript Gateway. Modul ini bertindak sebagai batas utama untuk menanamkan gateway secara terprogram di dalam aplikasi Node.js atau menjalankannya melalui antarmuka baris perintah (CLI). Permintaan memasuki siklus hidup gateway melalui instans server dan router yang diinisialisasi di sini.

## Ekspor (Exports)

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `Gateway` | class | `class Gateway` | Class export for Gateway. |
| `{ OpenApiDoc, OpenApiInfo }` | type | `type { OpenApiDoc, OpenApiInfo } from './core/openapi-generator.js'` | Type export for { OpenApiDoc, OpenApiInfo }. |

## Catatan (Notes)

### Gateway
Kelas `Gateway` mengatur inisialisasi server, pembacaan konfigurasi, dan perakitan pipeline.

### OpenApiDoc
Tipe OpenAPI yang diekspor mendefinisikan struktur kontrak saat membuat dokumentasi dari rute.

## Sumber (Source)

- `src/index.ts`
- `src/cli.ts`

## Lihat juga (See also)

- [Pendalaman: Arsitektur](/id/docs/deep-dive/architecture/)
