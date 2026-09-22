---
title: "Testing & Benchmarks"
description: "Menjalankan test suite, benchmark performa yang reproducible, dan batas-batas yang diketahui."
order: 13
section: "Guide"
track: "reference"
---

## Test Suite

Vitest, 918 tes di 59 file pada full run terakhir. Tiga jalur:

```bash
npm test                      # all suites
npm run test:unit             # tests/unit
npm run test:integration      # tests/integration (proxy + pipeline end-to-end)
npm run test:perf             # tests/performance (benchmarks with guards)
```

Suite performa memakai timing guard dengan headroom lebar. Guard fast-path pool di-set ke **50 µs/op** (dulu 5 µs; varians CI pernah terukur 5,26 µs di mesin homelab 4-core). Guard ini bersifat informasional — gagal pada regresi order-of-magnitude, bukan jitter satu digit.

## Benchmark

```bash
npm run benchmark            # load-test.js — hot path under real concurrency
npm run benchmark:router     # router match throughput
npm run benchmark:context    # context pool acquire/release
npm run benchmark:plugins    # plugin execution chain
```

Angka terkini di target homelab (4-core i5-6500T, Node 22):

| Scenario | Result | Note |
|---|---|---|
| Hot target path (100 conn) | **P99 5 ms · ~38.4k RPS** | target P99 < 10 ms ✓ |
| Pool acquire + release | ~1.5 µs/op | fast-path |
| Circuit breaker CLOSED fast-path | ~1.1 µs/req hemat | tanpa lock di steady state |
| Full proxy path @ 100 conn | ~3.2k RPS · P99 ~40 ms | plafon hardware-bound* |

\* Plafon full-proxy terikat round-trip loopback di mesin 4-core bersama (hop mentah `url`-forward saja terukur ~223 µs/op; kode gateway di atas hop mentah itu ~28% dari jalur). Ini batas mesin, bukan batas kode — didokumentasikan dan tidak dikejar ulang.

## Menjalankan Upstream Lokal untuk Integration Test

Integration test menjalankan upstream asli di port ephemeral; tidak butuh service eksternal. Untuk mensimulasikan sendiri:

```bash
# minimal upstream (any static server works)
python3 -m http.server 8080

# point the gateway at it
PORT=8088 npm start

curl http://localhost:8088/health   # should report the upstream as healthy
```
