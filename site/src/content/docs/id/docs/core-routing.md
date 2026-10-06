---
title: "Core Routing & Proxy"
description: "Radix router, reverse proxy pipeline, policy chaining, dan context pooling tanpa alokasi."
order: 4
section: "Features"
track: "reference"
---

Semua fitur di grup ini sudah **terimplementasi dan terverifikasi** — masing-masing punya pasangan spesifikasi FSD + ERD lengkap dan cakupan unit/integration di test suite repo.

## Radix Router

Radix Router adalah mesin pencocokan rute milik gateway. Tujuannya: memetakan
`method + path` HTTP yang masuk ke satu `RouteHandler` secepat mungkin, memakai dua
jalur lookup yang saling melengkapi:

- **Rute statis** (tanpa `:` atau `*`) disimpan di `Map<HttpMethod, Map<path, handler>>` — lookup **O(1)**.
- **Rute dinamis** (`:param`, wildcard `*`) disimpan di **radix tree** per method — lookup **O(log n)** terhadap jumlah segmen, bukan jumlah rute.

Implementasi: `src/core/router.ts` (250 baris), class `Router`. Tanpa dependensi —
cuma `Map`, `split`, dan rekursi biasa; tanpa regex, tanpa library eksternal
(sesuai prinsip zero-dependency proyek: `node:http`, `node:crypto`, tanpa Express).

### Konfigurasi

| Source | Field | Effect |
|---|---|---|
| `routes[]` di `config/gateway.config.json` | `method`, `path`, `handler ref`, `priority` | Sumber `ROUTE` (PERSISTED); dibaca sekali saat boot |
| `server{}` | `requestTimeout` | Bukan bagian router, tapi dipakai oleh `Server` yang memanggil `router.match` |
| — | `Router.clear()` | Mengosongkan semua Map + tree (dipakai oleh test / jalur hot-reload) |

Tidak ada konfigurasi runtime untuk router itu sendiri: struktur datanya ditetapkan di
constructor (7 method HTTP: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS).

### Edge cases

| Trigger | Behavior | User-visible result |
|---|---|---|
| Path tidak cocok dengan apa pun | `match` mengembalikan `null` | `Server` mengirim 404 `Not Found` |
| Dua rute dinamis berebut segmen yang sama (`:id` vs `:userId` di posisi yang sama) | Hanya ada satu node `paramChild`; nama param dari registrasi **pertama** yang menang | Nama param pertama yang dilihat handler |
| Wildcard bukan segmen terakhir (mis. `/files/*/edit`) | `insertRadix` berhenti di `*`; segmen sisanya diabaikan saat insert | Wildcard tetap terminal; perilaku terdokumentasi, hindari pola ini |
| Path dengan trailing slash (`/api/users/`) | `filter(s => s.length > 0)` membuang segmen kosong | `/api/users` dan `/api/users/` setara |
| Query string di URL | `Server` memisahkan `?query` sebelum `router.match` | Router hanya menerima path murni |
| Method tidak ada di enum 7-method | Tidak ada Map/tree untuknya | Match `null` → 404 |
| Backtrack segmen dinamis gagal (`/a/:x/b` vs request `/a/1/c`) | Param di-`delete`, walk mundur ke wildcard/`null` | 404 tanpa membocorkan params |


## Request Context Pool

Request Context Pool menyediakan objek `RequestContext` yang **dipakai ulang lintas
request** untuk mengurangi tekanan GC. Setiap request HTTP yang masuk butuh context
(requestId, method, path, headers, body, timestamps, dll.); tanpa pooling, setiap
request mengalokasikan objek baru → memory churn → GC jank. Pool melakukan pre-alokasi.

Implementasi:
- `src/core/context.ts` (185 baris) — `PoolableRequestContext` + `ContextPool` + `PoolMetrics`.
- `src/utils/pool.ts` (247 baris) — `ObjectPool<T>` generik + `BufferPool` (reuse byte-buffer).
- `src/core/cleanup-manager.ts` (427 baris) — `CleanupManager`: pelacakan resource per-request (timer, stream, event listener, AbortController), deteksi leak, cleanup terjamin.

Zero-dependency: cuma struktur JS (`Array.pop`, `Set`) — tanpa library pooling eksternal.

### Cara kerjanya

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

`PoolableRequestContext.reset()` membersihkan 14 field (requestId, startTime, method,
path, query, params, headers, body, req, res, upstream, state, responded, route,
timestamps) — tidak ada state request yang bisa bocor ke request berikutnya.

`ContextPool` (default `initialSize = 1000`):
- `acquire()` — `pool.pop()`; hit → `hits++`; pool kosong → `misses++` + `new PoolableRequestContext()` (objek overflow, di-GC saat release di atas maxSize).
- `release(ctx)` — pelindung double-release (`inUse.has`), `ctx.reset()`, `pool.push` hanya kalau `pool.length < maxSize`.
- `metrics()` — `{ size, available, inUse, hits, misses, totalAcquired }`; `getHitRate()` = hits/totalAcquired × 100.

`ObjectPool<T>` (generik, `src/utils/pool.ts`) mengikuti pola yang sama untuk objek apa pun dengan
`reset()`; `BufferPool` me-pool `Buffer` per ukuran (default 8192 B, 100 per ukuran)
dengan `WeakMap<Buffer, wrapper>` untuk release yang aman.

`CleanupManager` melengkapi pooling: resource yang menempel ke satu request
(`trackTimer`, `trackStream`, `trackEventListener`, `trackAbortController`)
dilacak per `requestId`; `cleanupRequest(requestId)` menjalankan semuanya via
`Promise.all`; deteksi leak berkala (interval 60 s, `unref()`) menandai resource
yang aktif > `leakDetectionThreshold` (default 60 s, aktif di `NODE_ENV=development`).

### Konfigurasi

| Source | Field | Default | Effect |
|---|---|---|---|
| Kode (constructor `Server`) | `ContextPool(1000)` | 1000 | Ukuran pool request-context (belum diekspor ke file config) |
| `CleanupConfig` | `enableLeakDetection` | `NODE_ENV === 'development'` | Pemindai leak berkala |
| `CleanupConfig` | `leakDetectionThreshold` | 60000 ms | Usia resource di atas nilai ini dihitung sebagai leak |
| `CleanupConfig` | `autoCleanupOnTimeout` | `true` | Cleanup otomatis saat timeout |
| `CleanupConfig` | `enableMetrics` | `true` | Statistik `totalCleanupTime`/`avgCleanupTime` |
| `ObjectPool` | `size` | 100 | Ukuran pool generik / BufferPool per-ukuran |
| `BufferPool` | `defaultSize` | 8192 | Ukuran buffer default |

### Edge cases

| Trigger | Behavior | User-visible result |
|---|---|---|
| 1000+ request konkuren | Pool kosong → `misses++`, context baru dialokasikan | Tetap dilayani; objek overflow di-GC saat release di atas maxSize |
| `release` dipanggil dua kali untuk ctx yang sama | Guard `inUse.has(ctx)` → no-op return | Tidak ada duplikasi di pool |
| Handler lupa membersihkan field (mis. `ctx.state`) | `reset()` membersihkan semuanya saat release | Tidak ada kebocoran data antar request |
| Timer/stream yatim saat request error | `cleanupRequest(requestId)` di jalur `finally` aplikasi | Resource ditutup; event loop tidak tertahan |
| Resource aktif > 60 s (mode dev) | `detectLeaks()` tiap 60 s + `logger.warn` | Operator melihat potensi leak di log |
| `cleanup()` melempar error | Ditangkap + `logger.error`; resource tetap dihapus dari pelacakan | Satu resource gagal tidak menjatuhkan yang lain |
| Shutdown setelah drain timeout | `Server` memaksa destroy sisa socket (`socket.destroy()`) | Koneksi tidak menahan shutdown |


## Request Pipeline

Request Pipeline adalah lapisan policy-chaining milik gateway (migrasi M2). Tujuannya:
menyediakan satu titik eksekusi untuk **inbound policy** (auth, cache, rate limit —
boleh short-circuit request sebelum sampai ke backend) dan **outbound policy**
(transformasi response sebelum dikirim ke client), menggantikan `preRouteHook`
ad-hoc di `Server`.

Implementasi:

| File | Contents |
|---|---|
| `src/pipeline/policy.ts` (16 baris) | Interface `GatewayPolicy` (`name`, opsional `executeInbound`/`executeOutbound`), tipe `OutboundResponse` |
| `src/pipeline/request-pipeline.ts` (56 baris) | Class `RequestPipeline`: `register`, `runInbound`, `runOutbound`, `static writeResponse` |
| `src/core/url-forward.ts` (93 baris) | `UrlForwarder` — forwarding upstream murni, diekstrak dari `ProxyHandler.proxyRequest` (monolit 560 → 490 baris) |
| `src/core/response-cache-policy.ts` (79 baris) | `ResponseCachePolicy` — konsumen nyata pertama dari `ResponseCache` (sebelumnya dead code) |
| `src/plugins/builtin/auth-jwt-policy.ts` (150 baris) | `AuthJwtPolicy` — verifikasi JWT sebagai policy; mengembalikan problem `Response`, identitas masuk ke `ctx.state.user` |

Tanpa dependensi eksternal. **Status: terimplementasi** — commit `99fd7d5` (M2),
`npm test` 790/790 passing.

### Cara kerjanya

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

1. **`register(policy)`** — menambah policy; nama duplikat ditolak
   (`Duplicate policy name: …`). Urutan registrasi = urutan eksekusi
   (`src/index.ts`: `AuthJwtPolicy` dulu, lalu `ResponseCachePolicy`).
2. **`runInbound(ctx)`** — menjalankan `executeInbound` di setiap policy yang punya
   hook-nya. `Response` pertama yang dikembalikan = **short-circuit**: dikembalikan ke `Server`,
   sisa chain dan handler dilewati. Semua `void`/tanpa hook → `null` → lanjut
   ke `ProxyHandler`.
3. **Penulisan short-circuit** — `RequestPipeline.writeResponse(res, response)`
   (static): menyalin `status` + headers dari Web `Response` ke `ServerResponse`,
   menulis body sekali (tanpa race `headersSent`).
4. **`UrlForwarder`** — meneruskan request ke upstream (fungsi murni, tanpa
   logika policy) — dipanggil oleh `ProxyHandler` setelah semua inbound policy lolos.
5. **`runOutbound(ctx, response)`** — composition chain: tiap `executeOutbound`
   boleh mengganti `OutboundResponse` (`{ statusCode, headers, body? }`);
   hasil policy terakhir yang ditulis. Error policy tidak pernah menulis langsung ke
   socket — mereka kembali sebagai problem `Response` lewat mekanisme yang sama.

### Konfigurasi

Tidak ada field `gateway.config.json` baru untuk pipeline itu sendiri. Wiring terjadi
di `src/index.ts`:

- `auth` (objek, opsional) di config → `AuthJwtPolicy` didaftarkan.
- `ResponseCachePolicy` selalu didaftarkan (memakai `ResponseCache`).
- `Server.setPipeline(pipeline)` — menggantikan `preRouteHook` (dihapus).

Registrasi policy bersifat programatik (TypeScript), bukan deklaratif —
array policy deklaratif tetap YAGNI (lihat index).

### Edge cases

| Trigger | Behavior | User-visible result |
|---|---|---|
| Dua policy dengan `name` yang sama | `register` melempar error sebelum melayani | Gagal boot cepat, bukan diam-diam |
| Cache HIT | `Response` dari cache langsung ke `writeResponse` | Upstream tidak disentuh; header `x-cache: HIT` (MISS saat diteruskan) |
| JWT tidak valid/kedaluwarsa | `AuthJwtPolicy` mengembalikan problem 401 | `application/problem+json`, upstream tidak dipakai |
| Inbound policy tanpa `executeInbound` | Dilewati (`continue`) | Policy khusus outbound aman dicampur |
| Outbound policy mengembalikan `void` | `current` dipertahankan | Composition chain opsional per policy |
| Response policy saat headers sudah terkirim | `writeResponse` hanya dipanggil dari satu jalur `Server` | Tidak ada double-write `headersSent` |


## Reverse Proxy Handler

Reverse Proxy Handler adalah jantung forwarding gateway: setelah `Radix-Router`
menemukan rute, handler ini meneruskan request ke upstream, mengembalikan
response ke client, dan memasang pelindung resilience di sepanjang jalan (circuit
breaker, health check, load balancing, transformasi, compression).

Implementasi: `src/core/proxy-handler.ts` (560 baris, class `ProxyHandler`) —

modularisasi adalah rencana **M2** dan didokumentasikan di
[Out of Scope (YAGNI)](#out-of-scope-yagni), bukan sebagai sesuatu yang sudah ada.
Zero-dependency: `node:http`, `node:https`, tanpa undici/axios/http-proxy.

### Cara kerjanya

Pipeline `ProxyHandler.handle(ctx)` — 8 langkah deterministik:

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

Jalur error: error apa pun sebelum response terkirim dipetakan —
`timeout` → 504 `gateway_timeout`, `no healthy upstream` → 503 `service_unavailable`,
lainnya → 502 `bad_gateway` (body JSON `{ error: { code, message } }`).

### Konfigurasi

`ProxyHandlerConfig` (override constructor dari `DEFAULT_CONFIG`):

| Field | Default | Effect |
|---|---|---|
| `enableBodyParsing` | `true` | Parse body POST/PUT/PATCH via `BodyParser` |
| `enableCircuitBreaker` | `true` | Satu `CircuitBreaker` per upstream id |
| `enableHealthChecking` | `true` | `HealthChecker.start(upstreams)` + passive check per request |
| `requestTimeout` | `30000` ms | Timeout request ke upstream |
| `enableRequestTransformations` | `true` | Rewrite header/path/body sebelum forwarding |
| `enableResponseTransformations` | `true` | Rewrite response sebelum dikirim |
| `enableCompression` | `true` | gzip/brotli/deflate via `CompressionHandler` |
| `enableAdvancedMetrics` | `true` | `AdvancedMetrics.record*` untuk route/upstream/error |
| `maxRequestSize` | 10 MB (10485760) | Tolak request kebesaran (langkah 1) |
| `maxResponseSize` | 50 MB (52428800) | Batas buffer response |
| `maxHeaderSize` | 16 KB (16384) | Batas ukuran header |

Sumber `UPSTREAM` (PERSISTED): `upstreams[]` di `config/gateway.config.json` —
`id, protocol, host, port, basePath, poolSize, timeout, healthCheck{}, weight`.
Diinjeksikan via `ProxyHandler.initialize(upstreams)`.

### Edge cases

| Trigger | Behavior | User-visible result |
|---|---|---|
| `content-length` > `maxRequestSize` | `throw 'Request size exceeds limit'` sebelum forwarding | 502 (pemetaan `bad_gateway`) — kebesaran juga sudah dicegah lebih awal oleh `Server` (413) |
| Semua upstream tidak sehat | `LoadBalancer.select` mengembalikan null | 503 `service_unavailable` |
| Timeout upstream (`requestTimeout`) | `proxyReq.destroy()`, agent di-`remove` dari pool, throw | 504 `gateway_timeout` |
| Error upstream di tengah stream | `proxyRes.on('error')` → agent dihapus, reject | 502 `bad_gateway` |
| Circuit breaker OPEN | `breaker.execute` short-circuit tanpa menyentuh upstream | Error cepat, detail di Resilience → Circuit Breaker |
| Body tanpa `content-length` (chunked) | `shouldParseBody` false; body tetap diteruskan kalau `ctx.body` ada | Forwarding berlanjut |
| Response yang bisa dikompresi (JSON besar + `accept-encoding: gzip`) | Negotiate + compress + header `Content-Encoding` | Response terkompresi; metrik ratio tercatat |
| Client IP untuk LB `ip-hash` | `X-Forwarded-For` → `X-Real-IP` → `socket.remoteAddress` (berurutan) | Routing sticky per IP |
| `shutdown()` dipanggil | `healthChecker.stop()` + `clientPool.destroy()` | Koneksi upstream ditutup bersih |

## WebSocket Tunneling

Penanganan `Upgrade` yang opt-in: ketika `proxy.enableWebSocket` diset, proxy handler
menyelesaikan handshake WebSocket ke upstream terpilih, menulis response
`101 Switching Protocols` ke client, dan menyalurkan kedua socket secara
bidireksional. Pipe byte mentah — tanpa inspeksi per-frame.

Implementasi: `ProxyHandler.tunnelUpgrade` di `src/core/proxy-handler.ts`;
rantai wiring `config.proxy.enableWebSocket` → `ProxyHandler({enableWebSocket})` →
`setRouter()` → `Server.setProxyHandler()` → `handleUpgrade`. Semua mata rantai opsional;
satu saja hilang, upgrade ditolak persis seperti sebelumnya.

| Trigger | Behavior |
|---|---|
| `enableWebSocket` tidak diset/false | Request upgrade ditolak seperti biasa |
| Handshake upstream gagal | Socket client di-destroy, tidak ada tunnel setengah terbuka |
| Upstream mati di tengah stream | Tunnel tertutup (tanpa failover di tengah stream) |

## OpenAPI Generator

Generator OpenAPI 3 zero-dependency di atas tabel rute yang hidup
(`src/core/openapi-generator.ts`). `generateOpenApi(routes, upstreams, info)`
menghasilkan paths (mengonversi `:param` → `{param}` dan `*` → `{wildcard}`), mengelompokkan
operasi ke tag berdasarkan segmen path pertama, dan memetakan upstream ke `servers`.
Berguna untuk mengekspos endpoint spesifikasi atau memberi makan generator client.

## Client Disconnect Propagation

Setiap request yang di-proxy mendapat `AbortController`; event `close` pada socket
client membatalkan fetch upstream yang sedang berjalan (`ForwardRequest.signal`). Caller
yang menghilang langsung berhenti mengonsumsi resource upstream. Listener-nya
dihapus di `finally` — `close` juga menyala saat penyelesaian normal, tanpa leak.

## Request Coalescing (single-flight)

`UrlForwarder.share()`: N request GET/HEAD identik yang sedang berjalan digabung jadi
satu fetch upstream. Stampede cache-miss hanya memakan satu panggilan upstream, bukan N.
Hanya GET/HEAD yang digabung; path atau method berbeda tidak pernah berbagi flight.

## Streaming Response Path

`ProxyHandlerConfig.streamingThreshold` (byte): ketika diset di atas nol dan
transformasi response dinonaktifkan, response GET/HEAD langsung di-stream ke
client via `UrlForwarder.forwardStreaming` — header diteruskan seketika,
body di-pipe tanpa `Buffer.concat`. Body kecil (Content-Length di bawah
threshold) tetap di jalur buffered tanpa biaya; body chunked/panjang-tak-diketahui
selalu di-stream.
