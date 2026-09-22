---
title: "Identity & Security"
description: "JWT auth, API-key engine, injeksi kredensial upstream, error RFC 7807."
order: 10
section: "Features"
track: "reference"
---

Keempat fitur di grup ini sudah **implemented dan terverifikasi** — masing-masing punya pasangan spek FSD + ERD lengkap dan coverage unit/integration di test suite repo.

## API Key Engine

- **Spek:** API-key engine bawaan bergaya Zuplo tapi dengan 0 dependency, dibangun di atas `node:crypto`: generator key dengan format `tsgk_<bucket>_<random32>_<checksum4>`, validasi berjenjang (format → checksum → cache), dan injeksi state consumer ke request context.
- **Kenapa penting:** Menutup celah "Authentication & Identity" vs Zuplo — tanpa ini gateway tidak punya model identitas consumer, dan rate limiter tidak bisa dinamis per tier/plan. Ini fondasi untuk per-customer rate limiting (M3, selesai) dan injeksi upstream (M4).

### Cara kerja

1. **Generate** (`generateApiKey`): engine membuat `tsgk_<bucket>_<random32>_<checksum4>` — bucket adalah scope/environment key (mis. `live`, `test`, regex `^[a-z0-9-]{1,16}$`), random32 = 24 byte dari `crypto.randomBytes` di-encode sebagai **base62 32 karakter**, checksum4 = 4 karakter hex terakhir dari **CRC32 (tabel 256 entri)** atas bagian sebelumnya (deteksi typo). Plaintext ditampilkan sekali; hanya hash sha256 yang disimpan (`hashKey`).
2. **Validasi berjenjang** (murah dulu, mahal belakangan) — alur di `ApiKeyPolicy`:
   ```
   incoming request
        │
        ├─ path in publicRoutes? ── yes ─▶ pass through (no auth)
        │                    no
        ▼
   header x-api-key present? ── no ─▶ Authorization: *** ── no ─▶ 401 Missing API key
        │ yes
        ▼
   regex format check O(1)? ── no ─▶ 401 Invalid API key format
        │ yes
        ▼
   CRC32 checksum timing-safe? ── no ─▶ 401 API key checksum mismatch
        │ yes
        ▼
   LRU+TTL cache (key = sha256) hit? ── yes ─▶ consumer from cache
        │ miss
        ▼
   ConsumerStore.resolveKey (lookup by keyHash)
        ├─ REVOKED / absent ─▶ 401 API key not found
        ├─ expiresAt passed ─▶ 401 API key has expired
        └─ ACTIVE ─▶ insert into cache (TTL 5s default)
        │
        ▼
   ctx.state['user'] = { sub: consumerId, data: { plan, rateLimit } }
   ```
3. **Injeksi state consumer**: key valid → set `ctx.state['user'] = { sub: consumerId, data: { plan, rateLimit } }` — secara struktur identik dengan `request.user` milik Zuplo (`sub`, `data`).
4. **Rate limiting per-consumer**: `ConsumerRateLimitPolicy` membaca `ctx.state['user'].data.rateLimit`, membangun token bucket per `sub` (refill `rateLimit/60` per detik), dan mengembalikan 429 problem+json + header `Retry-After` dan `X-RateLimit-Limit`/`X-RateLimit-Remaining` saat habis. `RateLimitPlugin` juga punya keyExtractor `'consumer'` yang membaca `ctx.state['user'].sub`.

### Konfigurasi

```json
{
  "apiKeys": {
    "enabled": true,
    "publicRoutes": ["/", "/health", "/metrics"],
    "headerName": "x-api-key",
    "cacheTtlSeconds": 5,
    "cacheMaxEntries": 10000,
    "consumers": [
      {
        "consumerId": "cust-acme",
        "plan": "pro",
        "rateLimit": 1000,
        "keys": [
          { "key": "tsgk_live_<random32>_<checksum4>" },
          { "key": "tsgk_live_<random32>_<checksum4>", "expiresAt": 1798761600000 }
        ]
      }
    ]
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `enabled` | boolean | harus `true` + minimal 1 consumer agar policy terdaftar |
| `publicRoutes` | string[] | route tanpa auth (default `[\"/\", \"/health\", \"/metrics\"]`) |
| `headerName` | string | header key (default `x-api-key`; fallback `Authorization: *** |
| `cacheTtlSeconds` | number | TTL cache validasi (default 5) — batas atas delay revoke efektif |
| `cacheMaxEntries` | number | kapasitas LRU cache (default 10000) |
| `consumers[].consumerId` | string | ID consumer unik |
| `consumers[].plan` | string | tier plan (default `free`) |
| `consumers[].rateLimit` | number | req/menit untuk token bucket per-consumer |
| `consumers[].keys[].key` | string | key plaintext (hanya config/boot, tidak pernah di-cache atau di-log) |
| `consumers[].keys[].expiresAt` | number? | epoch ms; setelah lewat → 401 expired |

### Edge case

- Key dengan prefix/format salah → ditolak O(1) tanpa akses store.
- Checksum tidak cocok → ditolak timing-safe (typo/transmisi rusak) tanpa lookup cache.
- Key valid tapi di-revoke → TTL cache membuat revoke efektif paling lambat setelah TTL habis (default 5 detik).
- Key melewati `expiresAt` → 401 `'API key has expired'` (dari `ERR_KEY_EXPIRED`).
- Consumer melebihi `rateLimit` → 429 problem+json dari `ConsumerRateLimitPolicy` dengan `Retry-After` + `X-RateLimit-*`.
- Restart gateway → semua consumer/key dibangun ulang dari config `apiKeys` (TRANSIENT, tanpa persistensi).


## JWT Auth Plugin

- **Spek:** Plugin inbound bawaan `auth-jwt` yang bertindak sebagai OAuth2/JWT Resource Server: memverifikasi Bearer token terhadap JWKS lokal (inline di `gateway.config.json`) tanpa dependency eksternal — hanya `node:crypto` (`createPublicKey`, `verify`).
- **Kenapa penting:** Gateway saat ini tidak punya auth policy bawaan. Plugin ini adalah lapisan identity & security pertama sebelum API key dan injeksi kredensial upstream menyusul.
- **Status:** Implemented. Plugin berbasis hook `auth-jwt.ts` (8 tes) + pipeline policy `auth-jwt-policy.ts` (5 tes), keduanya committed dan terverifikasi di suite 790/790.

### Cara kerja

`preRoute(ctx)` jalan di Plugin Execution Chain sebelum routing ke upstream:
1. **Bypass**: `enabled === false` → return; path ada di `publicRoutes` (sebuah Set, default `/`, `/health`, `/metrics`) → return.
2. **Guard header spoofing**: membuang SEMUA header inbound yang cocok dengan `/^(x-auth-|x-user-|x-roles|x-scopes|x-email)/i` — client tidak bisa memalsukan identitas yang akan diinjeksikan nanti.
3. **Ekstraksi token**: mewajibkan header `Authorization` dengan format `Bearer <token>` (case-insensitive); token harus 3 segmen base64url (header.payload.signature).
4. **Pemilihan key**: `header.alg` harus `RS256` (menolak `alg=none` dan serangan HS256-confusion); `header.kid` wajib; public key di-resolve dari `keyMap: Map<kid, KeyObject>` yang dibangun di konstruktor/`init()` dari `config.jwks.keys[]` (hanya `kty: RSA`, via `createPublicKey({ key: {kty,n,e}, format: 'jwk' })`).
5. **Verifikasi signature**: `verify('RSA-SHA256', Buffer.from(`${headerB64}.${payloadB64}`), publicKey, sig)` — signature base64url.
6. **Pengecekan claims** (berurutan): `exp + leeway < nowSec` → expired; `iss` === `config.issuer` (kalau di-set); `aud` === `config.audience` (kalau di-set). Leeway default 30 detik.
7. **Injeksi identitas upstream**: setelah sukses, set `x-auth-user-id` (dari `sub`), `x-auth-scopes` (dari `scopes`/`scope`), `x-auth-aud`, `x-auth-jti`, `x-auth-exp`, `x-auth-method: bearer_jwt`.
8. **Logging aman**: sukses hanya me-log `requestId`, `jti`, `sub`, `exp` — tidak pernah materi token.

### Konfigurasi

Objek `AuthJwtConfig` (via `plugins[]` di `gateway.config.json`):

| Field | Type | Default | Notes |
|---|---|---|---|
| `enabled` | boolean | `true` | `false` = plugin no-op |
| `issuer` | string | `https://auth.geopulser.local` | claim `iss` yang diharapkan; unset melewati pengecekan |
| `audience` | string | `geopulser-api` | claim `aud` yang diharapkan |
| `jwks` | `{ keys: JWK[] }` | - | RSA JWK (`kty`, `n`, `e`, `kid` wajib untuk lookup); di-parse saat boot + `init()` |
| `leewaySeconds` | number | `30` | toleransi clock-skew untuk `exp` |
| `publicRoutes` | string[] | `['/', '/health', '/metrics']` | path tanpa auth (exact-match, bukan glob) |

### Edge case

Semua kegagalan merespons 401 JSON `{ error: { code, message } }` + counter `metrics.recordError()`/`recordAuthFailure()` + log warn; `ctx.responded = true` (short-circuit, request tidak lanjut).

| Trigger | Code |
|---|---|
| Header `Authorization` hilang | `unauthorized` |
| Bukan format `Bearer` | `invalid_token` |
| Token bukan 3 segmen / JSON rusak | `invalid_token` |
| `alg` ≠ RS256 (termasuk `none`, HS256) | `invalid_algorithm` |
| `kid` hilang dari header | `missing_kid` |
| `kid` tidak ada di JWKS | `unknown_kid` |
| Signature tidak valid | `invalid_signature` |
| `exp` lewat + leeway | `token_expired` |
| `iss` / `aud` tidak cocok | `invalid_issuer` / `invalid_audience` |

Lainnya: JWK dengan `kty` non-RSA atau tanpa `kid` dilewati di `loadKeys()` (log error, boot tidak crash); path publicRoutes exact-match — `/healthz` TIDAK otomatis publik.


## RFC7807 Problem Details

Menstandarisasi payload error gateway ke **RFC 7807 (Problem Details for HTTP APIs)**
via helper `HttpProblems` + `createProblem`. Menggantikan hierarki `GatewayError`
+ serialisasi JSON ad-hoc dengan struktur standar: `type`, `title`, `status`,
`detail`, `instance`, `requestId`.

Implementasi: `src/pipeline/http-problems.ts` (111 baris) — zero dependency
(`JSON.stringify` + `Response` global, `Content-Type: application/problem+json`).

(dan `npm test` 790/790 passing, commit `99fd7d5`, M2).

### Cara kerja

1. `CATALOG` internal: 10 kelas error — tuple konstan
   `(slug, status, title)`: `bad-request` (400), `unauthorized` (401),
   `forbidden` (403), `not-found` (404), `payload-too-large` (413),
   `rate-limit-exceeded` (429), `internal-error` (500), `bad-gateway` (502),
   `service-unavailable` (503), `gateway-timeout` (504).
2. `createProblem(code, fields)` → lookup katalog, menyusun
   `{ type, title, status, detail?, instance?, requestId? }` — field opsional
   dihilangkan, bukan `null` — dan mengembalikan `Response` siap kirim.
   `type` = `https://gateway.internal/errors/<slug>`.
3. Helper `HttpProblems` (as-built): `badRequest`, `unauthorized`, `forbidden`,
   `notFound`, `payloadTooLarge`, `rateLimited`, `internal`, `badGateway`,
   `serviceUnavailable`, `gatewayTimeout` — masing-masing satu panggilan.
4. `rateLimited({ detail, limit, window, retryAfterSeconds })`: `detail` default-nya
   `"Rate limit of N requests per <window> exceeded. Try again in S seconds."`,
   header `Retry-After: <seconds>` di-set saat `retryAfterSeconds` diberikan.
5. `problemToJson(problem)` — serialisasi eksplisit (field opsional dilewati).
6. Short-circuit pipeline: inbound policy yang mengembalikan problem `Response` →
   `RequestPipeline.runInbound` berhenti, `RequestPipeline.writeResponse`
   mengirimnya ke client tanpa menyentuh backend handler.

### Konfigurasi

Tidak ada field konfigurasi. `TYPE_BASE` (`https://gateway.internal/errors`)
adalah konstanta modul — bukan config.

### Edge case

- Slug tidak ada di katalog → `ERR_UNKNOWN_PROBLEM_SLUG` (developer-facing).
- Status di luar 400–599 → `ERR_PROBLEM_STATUS`.
- 429 tanpa info kuota: `detail` boleh kosong — payload tetap valid RFC 7807;
  `Retry-After` hanya ada saat `retryAfterSeconds` eksplisit.
- `detail` tidak pernah menerima objek error mentah — hanya string teks;
  stack trace/path internal hanya masuk log server.


## Upstream Credential Injection

- **Spek:** Inbound policy yang melakukan injeksi kredensial upstream SETELAH caller terautentikasi dan SEBELUM request diteruskan ke origin. Dua policy 0-dep: `set-upstream-header` (melampirkan token internal statis, mis. `Authorization: Bearer *** dan `upstream-hmac-signature` (menandatangani body request dengan shared secret sebelum dikirim ke microservice internal).
- **Kenapa penting:** Menutup celah "Caller Auth vs Upstream Auth" vs Zuplo — kredensial upstream (token statis, secret HMAC) tidak boleh dipegang caller; gateway adalah satu-satunya pemegang. Krusial untuk BFF / microservice enterprise.

### Cara kerja

1. **Urutan pipeline**: policy ini jalan setelah policy autentikasi caller (JWT-Auth-Plugin / API-Key-Engine) lolos — caller divalidasi dulu, lalu gateway mempersenjatai request menuju origin.
2. **`set-upstream-header`**: konfigurasi statis `header → value` (mis. `Authorization: Bearer *** `x-internal-service: payments`). Header caller yang sensitif ditimpa, bukan dilewati.
3. **`upstream-hmac-signature`**: menghitung HMAC-SHA256 atas body request memakai shared secret per-upstream (`node:crypto` `createHmac`), melampirkan signature + timestamp ke header upstream (mis. `x-signature`, `x-timestamp`) — microservice internal memverifikasi bahwa request benar-benar datang dari gateway dan body tidak diubah.
4. **Pemisahan ketat**: caller auth (yang membuktikan client) ≠ upstream auth (yang membuktikan gateway ke origin). Kegagalan signature / secret hilang = «redacted-vault-secret» (request tidak diteruskan).

### Konfigurasi

| Field | Type | Notes |
|---|---|---|
| `policy` | `set-upstream-header` \| `upstream-hmac-signature` | tipe injeksi |
| `headers` | Record<string,string> | header statis untuk `set-upstream-header` |
| `secretRef` | string | nama shared secret HMAC (nilai tidak pernah inline) |
| `headerNamespace` | string | prefix header signature (mis. `x-signature`) |

### Edge case

- Request tanpa body (GET) → HMAC dihitung atas signing input tanpa body (canonical string: method+path+timestamp).
- Header upstream sudah di-set caller → ditimpa, tidak pernah diduplikasi.
- Shared secret salah/dirotasi → verifikasi gagal di microservice; gateway me-log + mencatat metrics, tanpa retry otomatis.
- Body besar → HMAC stream/hash inkremental untuk menghindari double buffering.
