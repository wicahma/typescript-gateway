---
title: "Pengujian & Benchmark"
description: "Spesifikasi test suite, perintah eksekusi, jaminan kelulusan, dan batas performa terukur."
---

Harness pengujian gateway memverifikasi kebenaran logika, ketahanan terhadap regresi, dan batas latensi di seluruh codebase menggunakan Vitest dan pustaka standar Node.

## Kategori Test Suite

Matriks pengujian terdiri dari jalur unit, integrasi, dan performa yang mencakup 1.075 pengujian:

| Suite | Jalur | Cakupan | Target Verifikasi |
| --- | --- | --- | --- |
| Unit | `tests/unit` | Logika komponen terisolasi | Kebenaran algoritmik, kasus tepi, penanganan galat |
| Integrasi | `tests/integration` | Pipeline proxy end-to-end | Siklus HTTP, pooling soket, urutan plugin, upstream |
| Performa | `tests/performance` | Microbenchmark dengan batas waktu | Batas alokasi memori, overhead daur ulang pool |

## Perintah Eksekusi

Jalankan test suite menggunakan skrip npm standar:

```bash
# Jalankan seluruh test suite
npm test

# Jalankan pengujian unit terisolasi
npm run test:unit

# Jalankan pengujian integrasi proxy penuh
npm run test:integration

# Jalankan penjaga regresi performa
npm run test:perf
```

## Jaminan Kelulusan Tes (Green Run)

Eksekusi tes yang berhasil membuktikan tiga jaminan formal:

1. **Kepatuhan Protokol**: Parsing HTTP yang sesuai standar RFC, penanganan kode status, normalisasi header, dan streaming body.
2. **Determinisme Ketahanan**: State machine circuit breaker berpindah secara konsisten antara CLOSED, OPEN, dan HALF-OPEN; jitter retry dan fallback bekerja deterministik dalam kondisi simulasi kegagalan.
3. **Invarian Zero-Allocation**: Konteks request dan pool objek berhasil didaur ulang tanpa kebocoran memori atau lonjakan alokasi heap V8.

## Batas dan Penjaga Performa

Jalur performa menjalankan pengujian waktu untuk mendeteksi regresi:

- **Batas Fast-Path Pool**: Siklus acquire/release pada request context pool dijaga pada batas `50 µs/op` (menoleransi variasi penjadwalan CPU pada runner CI).
- **Batas Loopback Round-Trip**: Batas throughput proxy penuh (~3,2k RPS, P99 ~40 ms pada 100 koneksi simultan pada mesin 4-core) dibatasi oleh latensi loopback kernel (hop upstream `node:http` membutuhkan ~223 µs/op). Overhead kode gateway adalah sekitar 28% dari total jalur.

## Benchmark Referensi

Skrip benchmark mandiri:

```bash
npm run benchmark            # Jalur cepat penuh dalam beban konkuren
npm run benchmark:router     # Throughput pencarian radix tree
npm run benchmark:context    # Kecepatan acquire dan release object pool
npm run benchmark:plugins    # Traversal rantai eksekusi plugin
```

Pengukuran dasar pada perangkat keras referensi (4-core x86_64, Node 22):

| Skenario | Hasil | Batas Target |
| --- | --- | --- |
| Jalur target cepat (100 koneksi) | P99 5 ms · ~38,4k RPS | P99 < 10 ms |
| Pool acquire + release | ~1,5 µs/op | < 50 µs/op |
| Circuit breaker CLOSED path | Hemat ~1,1 µs/req | Nol overhead penguncian |
| Jalur proxy penuh (100 koneksi) | ~3,2k RPS · P99 ~40 ms | Batas perangkat keras |
