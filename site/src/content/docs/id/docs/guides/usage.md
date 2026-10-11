---
title: "Panduan Penggunaan"
description: "Resep praktis: proxying, auth, rate limiting, caching, load balancing, dan plugin kustom."
order: 12
section: "Guide"
track: "guide"
---

Resep end-to-end buat setup gateway yang paling umum. Semua contoh memakai skema config asli dari `src/types/config.ts` dan `src/types/identity.ts` — nggak ada yang sekadar wacana.

## Reverse Proxy Dasar

Arahkan traffic ke satu backend. Route yang tidak termasuk daftar reserved (`/`, `/health`, `/metrics`) akan di-proxy ke upstream pertama yang dikonfigurasi.

```json
{
  "server": { "port": 3000, "host": "0.0.0.0" },
  "routes": [
    { "method": "GET", "path": "/api/:id", "priority": 0 },
    { "method": "POST", "path": "/api/orders", "priority": 0 },
    { "method": "GET", "path": "/static/*", "priority": 0 }
  ],
  "upstreams": [
    {
      "id": "backend",
      "protocol": "http",
      "host": "127.0.0.1",
      "port": 8080,
      "basePath": "",
      "poolSize": 10,
      "timeout": 30000,
      "healthCheck": {
        "enabled": true,
        "path": "/health",
        "interval": 30000,
        "timeout": 5000,
        "expectedStatus": 200
      }
    }
  ],
  "plugins": [],
  "performance": { "workerCount": 0, "contextPoolSize": 1000, "bufferPoolSize": 1000, "responsePoolSize": 1000, "enablePooling": true }
}
```

Pola path: `:param` menangkap satu segmen, `*` adalah wildcard di ujung. Trailing slash dianggap sama dengan tanpa trailing slash. Path reserved (`/`, `/health`, `/metrics`) selalu ditangani oleh gateway sendiri.

Jalankan dan verifikasi:

```bash
PORT=8088 npm start
curl http://localhost:8088/api/42          # -> proxied to backend /api/42
curl http://localhost:8088/health          # -> gateway health report
```

## Autentikasi JWT

Aktif saat blok `auth` ada dan `enabled !== false`. JWT diverifikasi terhadap JWKS (`node:crypto` saja — tanpa library JWT eksternal). Token yang tidak valid dapat response 401 `application/problem+json`; identitas yang valid masuk ke `ctx.state.user`.

```json
{
  "auth": {
    "enabled": true,
    "issuer": "https://id.example.com",
    "audience": "my-api",
    "leewaySeconds": 30,
    "publicRoutes": ["/health", "/metrics", "/auth/login"],
    "jwks": { "keys": [ { "kty": "RSA", "n": "...", "e": "AQAB", "kid": "2026-01" } ] }
  }
}
```

## API Key + Rate Limit per Consumer

Aktif saat `apiKeys.enabled` dan `apiKeys.consumers` di-set. Dua policy otomatis didaftarkan: `ApiKeyPolicy` (memvalidasi `x-api-key` terhadap key yang diterbitkan) dan `ConsumerRateLimitPolicy` (kuota per consumer).

```json
{
  "apiKeys": {
    "enabled": true,
    "headerName": "x-api-key",
    "cacheTtlSeconds": 60,
    "cacheMaxEntries": 1000,
    "publicRoutes": ["/health"],
    "consumers": [
      {
        "consumerId": "mobile-app",
        "plan": "free",
        "rateLimit": 100,
        "keys": [ { "key": "ak_live_...", "expiresAt": 1798761600000 } ]
      },
      {
        "consumerId": "partner-internal",
        "plan": "unlimited",
        "rateLimit": 0,
        "keys": [ { "key": "ak_live_..." } ]
      }
    ]
  }
}
```

`rateLimit` adalah jumlah request per menit per consumer; `0` berarti unlimited. Key diresolve lewat `ConsumerStore` in-memory dengan TTL cache di depannya — setelah hit pertama, validasi tinggal lookup cache.

## Response Caching

Aktif saat `responseCache.enabled` di-set. `ResponseCachePolicy` memotong jalan untuk cache hit sebelum upstream disentuh dan menambahkan header `x-cache: HIT|MISS`.

```json
{
  "responseCache": { "enabled": true }
}
```

## Injeksi Kredensial Upstream + HMAC Signing

Buat upstream yang butuh header statis atau HMAC request signing (misalnya service internal di balik pemeriksaan signature). Kredensial disimpan di config gateway; header diinjeksikan (atau signature dihitung) tepat sebelum diteruskan.

```json
{
  "upstreamCredentials": {
    "enabled": true,
    "credentials": [
      {
        "name": "billing-service",
        "headers": { "x-internal-token": "..." },
        "hmac": { "secret": "${BILLING_HMAC_SECRET}", "keyId": "gw-1", "headerNamespace": "x-hmac" }
      }
    ],
    "injection": { "credentialName": "billing-service", "publicRoutes": ["/health"] },
    "signing": { "credentialName": "billing-service", "publicRoutes": ["/health"] }
  }
}
```

Secret mendukung interpolasi env (`${VAR}` / `${VAR:-default}`) — jangan pernah commit secret mentah.

## Plugin Kustom (Level Kode)

Array `plugins` deklaratif memang ada di skema, tapi policy pipeline dirakit secara programatik di `src/index.ts`. Buat menambahkan logika inbound/outbound sendiri, implementasikan interface `GatewayPolicy` (`src/pipeline/policy.ts`) lalu daftarkan:

```ts
import { GatewayPolicy, RequestContext, OutboundResponse } from './pipeline/policy.js';

class TenantHeaderPolicy implements GatewayPolicy {
  name = 'tenant-header';

  // inbound: may return a Response to short-circuit, or void to continue
  async executeInbound(ctx: RequestContext): Promise<Response | void> {
    const tenant = ctx.headers['x-tenant'];
    if (!tenant) {
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Missing tenant', status: 400 }), {
        status: 400,
        headers: { 'content-type': 'application/problem+json' },
      });
    }
    ctx.state.tenant = tenant;
  }

  // outbound: receives and may replace the OutboundResponse
  async executeOutbound(ctx: RequestContext, response: OutboundResponse): Promise<OutboundResponse> {
    response.headers['x-tenant'] = String(ctx.state.tenant ?? '');
    return response;
  }
}

// in src/index.ts, after config load:
pipeline.register(new TenantHeaderPolicy());
```

Urutan eksekusi = urutan registrasi. Policy inbound pertama yang mengembalikan `Response` memotong rantai (upstream tidak pernah melihat request-nya). Policy outbound dikomposisikan kiri-ke-kanan atas `OutboundResponse`.

## Rate Limiting Programatik (Plugin Hook API)

Buat strategi limiter di luar kuota consumer di atas, `Plugin` hook API (`src/types/plugin.ts`) + `RateLimitPlugin` (`src/plugins/builtin/rate-limit-plugin.ts`) mendukung strategi token-bucket dan sliding-window dengan key berdasarkan IP, header, upstream, atau consumer:

```ts
import { createRateLimitPlugin } from './plugins/builtin/rate-limit-plugin.js';

const limiter = createRateLimitPlugin({
  enabled: true,
  strategies: [
    { name: 'api-burst', type: 'token-bucket', capacity: 50, refillRate: 10, keyExtractor: 'ip', includeHeaders: true },
    { name: 'api-quota', type: 'sliding-window', windowMs: 60000, maxRequests: 300, keyExtractor: 'header', headerName: 'x-api-key' },
  ],
});
// register on a PluginExecutionChain or run preRoute manually
```

Token bucket menyerap burst singkat dengan rata-rata yang stabil; sliding window menegakkan kuota keras "N per menit". Keduanya in-memory dan tanpa dependensi.

## Load Balancing Antar Upstream

Beberapa upstream dengan peran yang sama dipilih per request oleh `LoadBalancer` (round-robin / ip-hash / weighted; sadar kesehatan). Tandai `weight` per upstream untuk memiringkan traffic:

```json
{
  "upstreams": [
    { "id": "api-a", "host": "10.0.0.1", "port": 8080, "weight": 3, "healthCheck": { "enabled": true, "path": "/health" } },
    { "id": "api-b", "host": "10.0.0.2", "port": 8080, "weight": 1, "healthCheck": { "enabled": true, "path": "/health" } }
  ]
}
```

Upstream yang tidak sehat (menurut pemeriksaan aktif + pasif) langsung berhenti menerima traffic; circuit breaker per upstream mencegah retry storm saat terjadi gangguan parsial.

## Memverifikasi Setup Kamu

```bash
# health + upstream report
curl -s http://localhost:8088/health | jq

# metrics snapshot (latency histogram, pool hit rates, per-upstream stats)
curl -s http://localhost:8088/metrics | jq

# auth rejection path (expect 401 problem+json)
curl -i http://localhost:8088/api/private

# rate limit path (expect 429 after quota, with rate limit headers if enabled)
for i in $(seq 1 120); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8088/api/ping; done | sort | uniq -c
```
