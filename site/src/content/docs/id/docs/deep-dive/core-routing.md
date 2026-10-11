---
title: "Core Routing & Proxy"
description: "Radix router, reverse proxy pipeline, policy chaining, dan context pooling tanpa alokasi."
---

Setiap fitur di grup ini sudah **terimplementasi dan terverifikasi**, masing-masing dengan cakupan unit dan integration test di test suite repo.

## Apa yang Dilakukannya (What it does)

Lapisan core routing dan proxy mencakup engine pencocokan rute HTTP, manajemen context, dan pipeline penerusan reverse proxy pada TypeScript Gateway.

### Radix Router

Radix Router adalah mesin pencocokan rute milik gateway. Tujuannya: memetakan `method + path` HTTP yang masuk ke satu `RouteHandler` secepat mungkin, memakai dua jalur lookup yang saling melengkapi:

- **Rute statis** (tanpa `:` atau `*`) disimpan di `Map<HttpMethod, Map<path, handler>>` — lookup **O(1)**.
- **Rute dinamis** (`:param`, wildcard `*`) disimpan di **radix tree** per method — lookup **O(log n)** terhadap jumlah segmen, bukan jumlah rute.

Implementasi: `src/core/router.ts`, class `Router`. Tanpa dependensi eksternal — hanya menggunakan `Map`, `split`, dan rekursi standar.

### Request Context Pool

Request Context Pool menyediakan objek `RequestContext` yang **dipakai ulang lintas request** untuk mengurangi tekanan Garbage Collector (GC). Setiap request HTTP yang masuk butuh context (requestId, method, path, headers, body, timestamps, dll.); tanpa pooling, setiap request mengalokasikan objek baru yang memicu jeda GC. Pool melakukan pre-alokasi struktur data ini.

```
request arrives (Server.handleRequest)
  │
  ├─ ctx = contextPool.acquire()          ← pool.pop(); hit → reuse, miss → new
  ├─ populate ctx: requestId, startTime (hrtime.bigint), method, path, headers, req, res
  ├─ parse query (lazy, only when '?' present)
  ├─ match = router.match(method, path)   → ctx.params, ctx.route (setRoute)
  ├─ preRouteHook(ctx) → handler(ctx)     → sendResponse if not yet
  │
  └─ finally:
       metrics.recordLatency(startTime)
       logger.info({requestId, method, path, status, durationMs})
       contextPool.release(ctx)           ← inUse.delete → ctx.reset() → pool.push (if < maxSize)
```

`PoolableRequestContext.reset()` membersihkan 14 field (requestId, startTime, method, path, query, params, headers, body, req, res, upstream, state, responded, route, timestamps) sehingga data request tidak bocor ke request berikutnya.

### Request Pipeline & Policy Chaining

Request Pipeline adalah lapisan policy-chaining gateway. Pipeline ini menyediakan satu titik eksekusi untuk **inbound policy** (autentikasi, cache, rate limit — yang dapat memotong alur sebelum mencapai backend) dan **outbound policy** (transformasi respons sebelum dikirim ke klien).

```
Client → Server → ContextPool → Radix Router
      → Pipeline.runInbound  (policies in order)
            AuthJwtPolicy    → invalid JWT: 401 problem+json → short-circuit
            ResponseCachePolicy → HIT: cached Response      → short-circuit
            (all pass / void) → null → continue
      → ProxyHandler (UrlForwarder → upstream)
      → Pipeline.runOutbound (composition chain over OutboundResponse)
      → RequestPipeline.writeResponse → ServerResponse → Client
```

1. **`register(policy)`**: Mendaftarkan policy; nama duplikat ditolak. Urutan pendaftaran menentukan urutan eksekusi.
2. **`runInbound(ctx)`**: Menjalankan hook `executeInbound`. Kembalian `Response` pertama akan memotong jalur (short-circuit).
3. **Penulisan Short-Circuit**: `RequestPipeline.writeResponse` menyalin status dan header ke `ServerResponse` serta menulis body tanpa race condition `headersSent`.
4. **`UrlForwarder`**: Meneruskan request ke upstream setelah inbound policy lolos.
5. **`runOutbound(ctx, response)`**: Mengeksekusi rantai komposisi untuk mentransformasikan respons keluar.

### Reverse Proxy Handler

Pipeline `ProxyHandler.handle(ctx)` mengoordinasikan 8 langkah deterministik:

```
handle(ctx)
  │
  ├─ 1. Size check        content-length > maxRequestSize (default 10 MB) → throw
  ├─ 2. Request transform  RequestTransformer.transform(method, path, headers, body)
  ├─ 3. Body parse         BodyParser.parse(req) for POST/PUT/PATCH + content-length > 0
  ├─ 4. LB select          LoadBalancer.select({clientIp, path}) → upstream
  │                        (throw 'No healthy upstream available' when empty)
  ├─ 5. Circuit + proxy    CircuitBreaker.execute(proxyRequest) per upstream
  │     │
  │     └─ proxyRequest:   HttpClientPool.acquire(upstream) → keep-alive agent
  │                        http/https.request({host, port, basePath+path, agent})
  │                        buffer full response (chunks → Buffer.concat)
  │                        release agent back to pool; remove on error/timeout
  ├─ 6. Response transform ResponseTransformer.transform(path, status, headers, body)
  ├─ 7. Compression        shouldCompress(contentType, size, accept-encoding)
  │                        → negotiateAlgorithm → compress → addCompressionHeaders
  └─ 8. Send               res.writeHead(status, headers); res.write(body); res.end()
                           + recordLatency, passive health check, advanced metrics
```

### Tunneling WebSocket

Penanganan `Upgrade` opsional: ketika `proxy.enableWebSocket` aktif, proxy handler menyelesaikan handshake WebSocket dengan upstream terpilih, menulis respons `101 Switching Protocols` ke klien, dan menghubungkan kedua soket secara dua arah sebagai pipa byte murni.

### Utilitas Tambahan

- **OpenAPI Generator (`src/core/openapi-generator.ts`)**: Menghasilkan spesifikasi OpenAPI 3 dari tabel rute aktif.
- **Propagasi Pemutusan Klien**: Request yang di-proxy memasang `AbortController` yang terikat ke event `close` soket klien, menghentikan pengambilan upstream yang sedang berlangsung jika penelepon pergi.
- **Request Coalescing (Single-Flight)**: `UrlForwarder.share()` menggabungkan request GET/HEAD identik yang bersamaan menjadi satu panggilan upstream tunggal.
- **Jalur Streaming Respons**: `ProxyHandlerConfig.streamingThreshold` mengalirkan respons GET/HEAD di atas ambang batas ukuran langsung ke klien tanpa buffering.

## Konfigurasi (Configuration)

Perilaku core routing dan proxy dikendalikan melalui opsi berikut:

| Opsi | Tipe | Nilai Bawaan | Dampak |
| --- | --- | --- | --- |
| `routes[].method` | string | — | Metode HTTP yang didaftarkan ke router. |
| `routes[].path` | string | — | Pola path URL (`/static`, `/users/:id`, `/files/*`). |
| `routes[].priority` | number | `0` | Urutan prioritas kecocokan rute. |
| `server.requestTimeout` | number | `30000` | Batas waktu request masuk dalam milidetik. |
| `proxy.enableWebSocket` | boolean | `false` | Mengaktifkan tunneling WebSocket HTTP 101. |
| `proxy.streamingThreshold` | number | `0` | Ambang batas byte untuk langsung streaming tanpa buffer. |
| `proxy.enableBodyParsing` | boolean | `true` | Mem-parsing body request POST/PUT/PATCH. |
| `proxy.enableCircuitBreaker` | boolean | `true` | Menerapkan circuit breaker per upstream. |
| `proxy.enableHealthChecking` | boolean | `true` | Mengaktifkan health check aktif dan pasif untuk upstream. |
| `proxy.maxRequestSize` | number | `10485760` | Menolak payload request yang lebih besar dari batas ini (byte). |
| `proxy.maxResponseSize` | number | `52428800` | Batas buffer respons (50 MB). |
| `proxy.maxHeaderSize` | number | `16384` | Batas ukuran header maksimum dalam byte. |

## Interaksi Pipeline (Interactions)

Core routing berkoordinasi dengan bagian pipeline gateway lainnya dalam urutan berikut:

1. **Resolusi Router**: `RadixRouter` memetakan path dan mengekstrak parameter URL (`ctx.params`).
2. **Penegakan Inbound Policy**: `RequestPipeline.runInbound` mengeksekusi autentikasi, cache, dan rate limiting secara berurutan. Jika ada policy yang mengembalikan `Response`, eksekusi memotong alur dan melewati penerusan upstream.
3. **Pemilihan Load Balancer**: Menyaring target sehat dari `HealthChecker` dan memilih upstream berdasarkan algoritma yang dikonfigurasi.
4. **Pemeriksaan Circuit Breaker**: Memastikan target upstream berstatus `CLOSED` atau probe `HALF-OPEN` sebelum meminjam koneksi soket HTTP.
5. **Penerusan Upstream & Outbound Policy**: Mengalirkan data melalui `HttpClientPool`, menerapkan transformasi respons via `runOutbound`, dan mengirimkan byte terkompresi ke klien.

## Tradeoff dan Mode Kegagalan (Tradeoffs and failure modes)

### Memory Pooling vs Lonjakan Alokasi

Pre-alokasi context (`ContextPool(1000)`) menghilangkan jeda GC di bawah beban throughput tinggi yang stabil. Jika request bersamaan melebihi kapasitas pool, pool mengalokasikan objek baru di luar pool. Saat dibebaskan, objek limpahan tersebut dibersihkan oleh GC secara normal.

### Degradasi Upstream dan Batas Waktu

- **Upstream Timeout**: Jika upstream gagal merespons dalam `requestTimeout`, soket dihancurkan, dihapus dari pool, dan gateway mengembalikan `504 Gateway Timeout`.
- **Semua Upstream Tidak Sehat**: Jika load balancer tidak menemukan instance upstream yang sehat, gateway merespons dengan `503 Service Unavailable`.
- **Pemutusan Klien**: Jika klien menutup koneksi saat data sedang dialirkan, `AbortSignal` segera membatalkan request upstream untuk mencegah pemborosan sumber daya.

### Matriks Skenario Kegagalan

| Skenario | Perilaku | Hasil / Respons |
| --- | --- | --- |
| Rute tidak ditemukan | `match` mengembalikan `null` | 404 Not Found |
| Dua rute dinamis berebut segmen sama | Nama parameter pertama menang | Penugasan parameter deterministik |
| Body request terlalu besar | `content-length > maxRequestSize` | 413 Payload Too Large / 502 Bad Gateway |
| Eror upstream di tengah stream | Soket memicu eror, koneksi dilepas | 502 Bad Gateway |
| Nama policy duplikat didaftarkan | Pipeline melempar eror saat start | Proses crash cepat saat boot |
