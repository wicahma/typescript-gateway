---
title: "Core Routing & Proxy (F1)"
description: "Radix router, reverse proxy pipeline, policy chaining, and zero-allocation context pooling."
order: 4
section: "Features"
---

# Core Routing & Proxy

Radix router, reverse proxy pipeline, policy chaining, and zero-allocation context pooling.

All 4 features in this group are **implemented and verified** — each has a full FSD + ERD spec pair and unit/integration coverage in the repo test suite.

## Radix Router

Radix Router adalah mesin pencocokan rute (route matching) gateway. Tujuannya:
memetakan `method + path` HTTP yang masuk ke satu `RouteHandler` secepat mungkin,
dengan dua jalur lookup yang saling melengkapi:

- **Rute statis** (tanpa `:` atau `*`) disimpan di `Map<HttpMethod, Map<path, handler>>` — lookup **O(1)**.
- **Rute dinamis** (`:param`, `*` wildcard) disimpan dalam **radix tree** per method — lookup **O(log n)** terhadap jumlah segmen, bukan jumlah rute.

Implementasi: `src/core/router.ts` (250 baris), kelas `Router`. Nol dependensi —
hanya `Map`, `split`, dan rekursi biasa; tanpa regex, tanpa library eksternal
(sesuai prinsip zero-dependency proyek: `node:http`, `node:crypto`, tanpa Express).

### Configuration

| Sumber | Field | Efek |
|---|---|---|
| `routes[]` di `config/gateway.config.json` | `method`, `path`, `handler ref`, `priority` | Sumber `ROUTE` (PERSISTED); dibaca sekali saat boot |
| `server{}` | `requestTimeout` | Bukan bagian router, tapi dipakai `Server` yang memanggil `router.match` |
| — | `Router.clear()` | Mengosongkan semua Map + tree (dipakai test / hot-reload path) |

Tidak ada konfigurasi runtime untuk router sendiri: struktur data fixed di konstruktor
(7 method HTTP: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS).

### Edge cases

| Trigger | Perilaku | Hasil user-visible |
|---|---|---|
| Path tidak match apa pun | `match` return `null` | `Server` mengirim 404 `Not Found` |
| Dua rute dinamis berebut segmen yang sama (`:id` vs `:userId` di posisi sama) | Node `paramChild` hanya satu; nama param dari registrasi **pertama** menang | Param name pertama yang terlihat di handler |
| Wildcard bukan segmen terakhir (mis. `/files/*/edit`) | `insertRadix` break di `*`; sisa segmen diabaikan saat insert | Wildcard tetap terminal; perilaku terdokumentasi, hindari pola ini |
| Path dengan trailing slash (`/api/users/`) | `filter(s => s.length > 0)` membuang segmen kosong | `/api/users` dan `/api/users/` setara |
| Query string di URL | `Server` memisahkan `?query` sebelum `router.match` | Router hanya menerima path murni |
| Method tidak ada di 7 enum | Tidak ada Map/tree-nya | Match `null` → 404 |
| Segmentasi backtrack gagal (`/a/:x/b` vs request `/a/1/c`) | Param di-`delete`, naik ke wildcard/`null` | 404 tanpa param bocor |


## Request Context Pool

Request Context Pool menyediakan objek `RequestContext` yang **di-reuse antar
request** untuk menekan tekanan GC. Setiap request HTTP yang masuk harus punya
konteks (requestId, method, path, headers, body, timestamps, dsb.); tanpa pooling,
tiap request mengalokasikan objek baru → churn memori → jank GC. Pool pre-allocate

Implementasi:
- `src/core/context.ts` (185 baris) — `PoolableRequestContext` + `ContextPool` + `PoolMetrics`.
- `src/utils/pool.ts` (247 baris) — `ObjectPool<T>` generik + `BufferPool` (reuse byte buffer).
- `src/core/cleanup-manager.ts` (427 baris) — `CleanupManager`: tracking resource per request (timer, stream, event listener, AbortController), leak detection, cleanup terjamin.

Zero-dependency: hanya struktur JS (`Array.pop`, `Set`) — tanpa library pooling eksternal.

### How it works

```
request masuk (Server.handleRequest)
  │
  ├─ ctx = contextPool.acquire()          ← pool.pop(); hit → reuse, miss → new
  ├─ isi ctx: requestId, startTime (hrtime.bigint), method, path, headers, req, res
  ├─ parse query (lazy, hanya bila ada '?')
  ├─ match = router.match(method, path)   → ctx.params, ctx.route (setRoute)
  ├─ preRouteHook(ctx) → handler(ctx)     → sendResponse bila belum
  │
  └─ finally:
       metrics.recordLatency(startTime)
       logger.info({requestId, method, path, status, durationMs})
       contextPool.release(ctx)           ← inUse.delete → ctx.reset() → pool.push (bila < maxSize)
```

`PoolableRequestContext.reset()` mengosongkan 14 field (requestId, startTime, method,
path, query, params, headers, body, req, res, upstream, state, responded, route,
timestamps) — tidak ada state request yang bisa bocor ke request berikutnya.

`ContextPool` (default `initialSize = 1000`):
- `acquire()` — `pool.pop()`; hit → counter `hits++`; pool kosong → `misses++` + `new PoolableRequestContext()` (overflow object, dibuang GC saat release di atas maxSize).
- `release(ctx)` — guard double-release (`inUse.has`), `ctx.reset()`, `pool.push` hanya bila `pool.length < maxSize`.
- `metrics()` — `{ size, available, inUse, hits, misses, totalAcquired }`; `getHitRate()` = hits/totalAcquired × 100.

`ObjectPool<T>` (generik, `src/utils/pool.ts`) pola sama untuk objek apapun yang punya
`reset()`; `BufferPool` mem-pool `Buffer` per ukuran (default 8192 B, 100 per ukuran)
dengan `WeakMap<Buffer, wrapper>` untuk release yang aman.

`CleanupManager` melengkapi pooling: resource yang melekat pada satu request
(`trackTimer`, `trackStream`, `trackEventListener`, `trackAbortController`)
didata per `requestId`; `cleanupRequest(requestId)` menjalankan semuanya via
`Promise.all`; leak detection periodik (interval 60 s, `unref()`) menandai resource
aktif > `leakDetectionThreshold` (default 60 s, aktif di `NODE_ENV=development`).

### Configuration

| Sumber | Field | Default | Efek |
|---|---|---|---|
| Kode (`Server` konstruktor) | `ContextPool(1000)` | 1000 | Ukuran pool konteks request (belum diekspor ke config file) |
| `CleanupConfig` | `enableLeakDetection` | `NODE_ENV === 'development'` | Leak scanner periodik |
| `CleanupConfig` | `leakDetectionThreshold` | 60000 ms | Ambang usia resource dianggap leak |
| `CleanupConfig` | `autoCleanupOnTimeout` | `true` | Cleanup otomatis saat timeout |
| `CleanupConfig` | `enableMetrics` | `true` | Statistik `totalCleanupTime`/`avgCleanupTime` |
| `ObjectPool` | `size` | 100 | Ukuran pool generik / per-ukuran BufferPool |
| `BufferPool` | `defaultSize` | 8192 | Ukuran buffer default |

### Edge cases

| Trigger | Perilaku | Hasil user-visible |
|---|---|---|
| 1000+ request konkuren | Pool kosong → `misses++`, konteks baru dialokasi | Tetap dilayani; objek overflow dibuang GC saat release di atas maxSize |
| `release` dipanggil dua kali untuk ctx sama | Guard `inUse.has(ctx)` → return tanpa efek | Tidak ada duplikasi di pool |
| Handler lupa membersihkan field (mis. `ctx.state`) | `reset()` mengosongkan semuanya saat release | Tidak ada kebocoran data antar request |
| Timer/stream yatim saat request error | `cleanupRequest(requestId)` di `finally` path aplikasi | Resource ditutup; tidak menggantung event loop |
| Resource aktif > 60 s (dev mode) | `detectLeaks()` tiap 60 s + `logger.warn` | Operator melihat potensi leak di log |
| `cleanup()` melempar | Catch + `logger.error`; resource tetap dihapus dari tracking | Satu resource gagal tidak menjatuhkan cleanup lain |
| Shutdown saat drain timeout | `Server` force-destroy socket tersisa (`socket.destroy()`) | Koneksi tidak menggantung shutdown |


## Request Pipeline

Request Pipeline adalah lapisan policy chaining gateway (migrasi M2). Tujuannya:
menyediakan satu titik eksekusi untuk **inbound policy** (auth, cache, rate-limit
— bisa short-circuit request sebelum menyentuh backend) dan **outbound policy**
(transformasi response sebelum dikirim ke client), menggantikan `preRouteHook`
ad-hoc di `Server`.

Implementasi:

| File | Isi |
|---|---|
| `src/pipeline/policy.ts` (16 baris) | interface `GatewayPolicy` (`name`, opsional `executeInbound`/`executeOutbound`), tipe `OutboundResponse` |
| `src/pipeline/request-pipeline.ts` (56 baris) | kelas `RequestPipeline`: `register`, `runInbound`, `runOutbound`, `static writeResponse` |
| `src/core/url-forward.ts` (93 baris) | `UrlForwarder` — forwarding upstream murni, diekstrak dari `ProxyHandler.proxyRequest` (monolith 560 → 490 baris) |
| `src/core/response-cache-policy.ts` (79 baris) | `ResponseCachePolicy` — konsumen riil pertama `ResponseCache` (sebelumnya dead code) |
| `src/plugins/builtin/auth-jwt-policy.ts` (150 baris) | `AuthJwtPolicy` — verifikasi JWT sebagai policy; mengembalikan problem `Response`, identitas ke `ctx.state.user` |

Nol dependensi eksternal. **Status: implemented** — commit `99fd7d5` (M2),
`npm test` 790/790 lulus.

### How it works

```
Client → Server → ContextPool → Radix Router
      → Pipeline.runInbound  (policies in order)
            AuthJwtPolicy    → JWT invalid: 401 problem+json → short-circuit
            ResponseCachePolicy → HIT: cached Response      → short-circuit
            (semua pass / void) → null → lanjut
      → ProxyHandler (UrlForwarder → upstream)
      → Pipeline.runOutbound (composition chain atas OutboundResponse)
      → RequestPipeline.writeResponse → ServerResponse → Client
```

1. **`register(policy)`** — tambah policy; nama duplikat ditolak
   (`Duplicate policy name: …`). Urutan registrasi = urutan eksekusi
   (`src/index.ts`: `AuthJwtPolicy` dulu, lalu `ResponseCachePolicy`).
2. **`runInbound(ctx)`** — jalankan `executeInbound` tiap policy yang punya
   hook. Return `Response` pertama = **short-circuit**: dikembalikan ke `Server`,
   sisa chain dan handler di-skip. Semua `void`/tanpa hook → `null` → lanjut
   ke `ProxyHandler`.
3. **Short-circuit write** — `RequestPipeline.writeResponse(res, response)`
   (static): salin `status` + headers dari Web `Response` ke `ServerResponse`,
   tulis body sekali (tanpa race `headersSent`).
4. **`UrlForwarder`** — forward request ke upstream (fungsi murni, tanpa logika
   policy) — dipanggil `ProxyHandler` setelah semua inbound policy pass.
5. **`runOutbound(ctx, response)`** — chain komposisi: tiap `executeOutbound`
   boleh mengganti `OutboundResponse` (`{ statusCode, headers, body? }`);
   hasil policy terakhir yang ditulis. Error policy tidak menulis langsung ke
   socket — kembali sebagai problem `Response` via mekanisme yang sama.

### Configuration

Tidak ada field `gateway.config.json` baru untuk pipeline itu sendiri. Wiring
terjadi di `src/index.ts`:

- `auth` (object, opsional) di config → `AuthJwtPolicy` diregistrasi.
- `ResponseCachePolicy` selalu diregistrasi (memakai `ResponseCache` F3).
- `Server.setPipeline(pipeline)` — menggantikan `preRouteHook` (dihapus).

Registrasi policy programmatically (TypeScript), bukan declarative —
declarative policy arrays masih YAGNI (lihat index).

### Edge cases

| Trigger | Perilaku | Hasil user-visible |
|---|---|---|
| Dua policy dengan `name` sama | `register` throw sebelum serve | Boot gagal cepat, bukan silent |
| Cache HIT | `Response` dari cache langsung ke `writeResponse` | Upstream tidak disentuh; header `x-cache: HIT` (MISS bila forward) |
| JWT invalid/expired | `AuthJwtPolicy` return 401 problem | `application/problem+json`, upstream tidak dikonsumsi |
| Policy inbound tidak punya `executeInbound` | Di-skip (`continue`) | Outbound-only policy aman dicampur |
| Outbound policy return `void` | `current` tetap dipakai | Chain komposisi opsional per policy |
| Response policy saat header sudah terkirim | `writeResponse` hanya dipanggil dari jalur tunggal `Server` | Tidak ada double-write `headersSent` |


## Reverse Proxy Handler

Reverse Proxy Handler adalah jantung forwarding gateway: setelah `Radix-Router`
menemukan rute, handler inilah yang meneruskan request ke upstream, mengembalikan
respons ke client, dan memasang guard resilience di sepanjang jalan (circuit
breaker, health check, load balancing, transformasi, kompresi).

Implementasi: `src/core/proxy-handler.ts` (560 baris, kelas `ProxyHandler`) —

modular adalah rencana **M2** dan didokumentasikan di bagian
[Out of Scope (YAGNI)]](#out-of-scope-yagni), bukan sebagai sesuatu yang sudah ada.
Zero-dependency: `node:http`, `node:https`, tanpa undici/axios/http-proxy.

### How it works

Pipeline `ProxyHandler.handle(ctx)` — 8 langkah deterministik:

```
handle(ctx)
  │
  ├─ 1. Size check        content-length > maxRequestSize (default 10 MB) → throw
  ├─ 2. Request transform  RequestTransformer.transform(method, path, headers, body)
  ├─ 3. Body parse         BodyParser.parse(req) utk POST/PUT/PATCH + content-length > 0
  ├─ 4. LB select          LoadBalancer.select({clientIp, path}) → upstream
  │                        (throw 'No healthy upstream available' bila kosong)
  ├─ 5. Circuit + proxy    CircuitBreaker.execute(proxyRequest) per upstream
  │     │
  │     └─ proxyRequest:   HttpClientPool.acquire(upstream) → agent keep-alive
  │                        http/https.request({host, port, basePath+path, agent})
  │                        buffer respons penuh (chunks → Buffer.concat)
  │                        release agent balik ke pool; remove bila error/timeout
  ├─ 6. Response transform ResponseTransformer.transform(path, status, headers, body)
  ├─ 7. Compression        shouldCompress(contentType, size, accept-encoding)
  │                        → negotiateAlgorithm → compress → addCompressionHeaders
  └─ 8. Send               res.writeHead(status, headers); res.write(body); res.end()
                           + recordLatency, passive health check, advanced metrics
```

Error path: error apa pun sebelum respons terkirim di-mapping —
`timeout` → 504 `gateway_timeout`, `no healthy upstream` → 503 `service_unavailable`,
lainnya → 502 `bad_gateway` (body JSON `{ error: { code, message } }`).

### Configuration

`ProxyHandlerConfig` (constructor override `DEFAULT_CONFIG`):

| Field | Default | Efek |
|---|---|---|
| `enableBodyParsing` | `true` | Parse body POST/PUT/PATCH via `BodyParser` |
| `enableCircuitBreaker` | `true` | Satu `CircuitBreaker` per upstream id |
| `enableHealthChecking` | `true` | `HealthChecker.start(upstreams)` + passive check per request |
| `requestTimeout` | `30000` ms | Timeout permintaan ke upstream |
| `enableRequestTransformations` | `true` | Header/path/body rewrite sebelum forward |
| `enableResponseTransformations` | `true` | Rewrite respons sebelum dikirim |
| `enableCompression` | `true` | gzip/brotli/deflate via `CompressionHandler` |
| `enableAdvancedMetrics` | `true` | `AdvancedMetrics.record*` untuk route/upstream/error |
| `maxRequestSize` | 10 MB (10485760) | Tolak request besar (step 1) |
| `maxResponseSize` | 50 MB (52428800) | Batas buffer respons |
| `maxHeaderSize` | 16 KB (16384) | Batas ukuran header |

Sumber `UPSTREAM` (PERSISTED): `upstreams[]` di `config/gateway.config.json` —
`id, protocol, host, port, basePath, poolSize, timeout, healthCheck{}, weight`.
Di-inject lewat `ProxyHandler.initialize(upstreams)`.

### Edge cases

| Trigger | Perilaku | Hasil user-visible |
|---|---|---|
| `content-length` > `maxRequestSize` | `throw 'Request size exceeds limit'` sebelum forward | 502 (`bad_gateway` mapping) — ukuran besar juga dicegah lebih awal oleh `Server` (413) |
| Semua upstream unhealthy | `LoadBalancer.select` return null | 503 `service_unavailable` |
| Upstream timeout (`requestTimeout`) | `proxyReq.destroy()`, agent di-`remove` dari pool, throw | 504 `gateway_timeout` |
| Respons upstream error mid-stream | `proxyRes.on('error')` → agent di-remove, reject | 502 `bad_gateway` |
| Circuit breaker OPEN | `breaker.execute` short-circuit tanpa menyentuh upstream | Error cepat, detail di F2 Circuit-Breaker |
| Body tanpa `content-length` (chunked) | `shouldParseBody` false; body tetap diteruskan bila `ctx.body` ada | Forward tetap jalan |
| Respons kompresibel (JSON besar + `accept-encoding: gzip`) | Negotiate + compress + header `Content-Encoding` | Respons terkompresi; metrik rasio tercatat |
| Client IP untuk LB `ip-hash` | `X-Forwarded-For` → `X-Real-IP` → `socket.remoteAddress` (berurutan) | Sticky routing per IP |
| `shutdown()` dipanggil | `healthChecker.stop()` + `clientPool.destroy()` | Koneksi upstream ditutup bersih |
