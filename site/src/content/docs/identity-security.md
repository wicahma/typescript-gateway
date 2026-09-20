---
title: "Identity & Security (F7)"
description: "JWT auth, API-key engine, upstream credential injection, RFC 7807 errors."
order: 10
section: "Features"
---

# Identity & Security

JWT auth, API-key engine, upstream credential injection, RFC 7807 errors.

All 4 features in this group are **implemented and verified** — each has a full FSD + ERD spec pair and unit/integration coverage in the repo test suite.

## API Key Engine

- **Spesifikasi:** Engine API key bawaan bergaya Zuplo tapi 0-dependency, dibangun di atas `node:crypto`: generator key dengan format `tsgk_<bucket>_<random32>_<checksum4>`, validasi berjenjang (format → checksum → cache), dan injeksi consumer state ke konteks request.
- **Urgensi:** Menutup gap "Authentication & Identity" terhadap Zuplo — tanpa ini gateway tidak punya model identitas konsumen, dan rate limiter tidak bisa dynamic per tier/plan. Menjadi dasar rate limiting per-customer (M3, done) dan upstream injection (M4).

### How it works

1. **Generate** (`generateApiKey`): engine membuat key `tsgk_<bucket>_<random32>_<checksum4>` — bucket adalah lingkup/environment key (mis. `live`, `test`, regex `^[a-z0-9-]{1,16}$`), random32 = 24 byte dari `crypto.randomBytes` yang di-encode **base62 32-karakter**, checksum4 = 4 hex char terakhir hasil **CRC32 (tabel 256 entri)** atas bagian sebelumnya (deteksi typo). Plaintext ditampilkan sekali; yang disimpan hanya sha256 hash (`hashKey`).
2. **Validasi berjenjang** (murah dulu, mahal belakangan) — alur di `ApiKeyPolicy`:
   ```
   request masuk
        │
        ├─ path di publicRoutes? ── ya ─▶ lewat (tanpa auth)
        │                    tidak
        ▼
   header x-api-key ada? ── tidak ─▶ Authorization: Bearer? ── tidak ─▶ 401 Missing API key
        │ ya
        ▼
   format regex O(1)? ── tidak ─▶ 401 Invalid API key format
        │ ya
        ▼
   checksum CRC32 timing-safe? ── tidak ─▶ 401 API key checksum mismatch
        │ ya
        ▼
   cache LRU+TTL (key = sha256) hit? ── ya ─▶ consumer dari cache
        │ miss
        ▼
   ConsumerStore.resolveKey (lookup by keyHash)
        ├─ REVOKED / tidak ada ─▶ 401 API key not found
        ├─ expiresAt lewat ─▶ 401 API key has expired
        └─ ACTIVE ─▶ masukkan cache (TTL 5s default)
        │
        ▼
   ctx.state['user'] = { sub: consumerId, data: { plan, rateLimit } }
   ```
3. **Consumer state injection**: key valid → isi `ctx.state['user'] = { sub: consumerId, data: { plan, rateLimit } }` — struktur identik dengan `request.user` Zuplo (`sub`, `data`).
4. **Rate limiting per consumer**: `ConsumerRateLimitPolicy` membaca `ctx.state['user'].data.rateLimit`, membangun token bucket per `sub` (refill `rateLimit/60` per detik), mengembalikan 429 problem+json + header `Retry-After` dan `X-RateLimit-Limit`/`X-RateLimit-Remaining` saat habis. `RateLimitPlugin` juga punya keyExtractor `'consumer'` yang membaca `ctx.state['user'].sub`.

### Configuration

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

| Field | Tipe | Keterangan |
|---|---|---|
| `enabled` | boolean | wajib `true` + minimal 1 consumer agar policy diregistrasi |
| `publicRoutes` | string[] | route tanpa auth (default `["/", "/health", "/metrics"]`) |
| `headerName` | string | header key (default `x-api-key`; fallback `Authorization: Bearer`) |
| `cacheTtlSeconds` | number | TTL validation cache (default 5) — batas atas delay efektif revoke |
| `cacheMaxEntries` | number | kapasitas LRU cache (default 10000) |
| `consumers[].consumerId` | string | ID unik consumer |
| `consumers[].plan` | string | tier plan (default `free`) |
| `consumers[].rateLimit` | number | req/menit untuk token bucket per consumer |
| `consumers[].keys[].key` | string | plaintext key (hanya di config boot, tidak pernah di-cache/log) |
| `consumers[].keys[].expiresAt` | number? | epoch ms; lewat → 401 expired |

### Edge cases

- Key salah prefix/format → ditolak O(1) tanpa akses store.
- Checksum beda → ditolak timing-safe (typo/transmisi rusak) tanpa cache lookup.
- Key valid tapi dicabut → cache TTL membuat revoke efektif maksimal setelah TTL habis (default 5 detik).
- Key `expiresAt` lewat → 401 `'API key has expired'` (dari `ERR_KEY_EXPIRED`).
- Consumer melebihi `rateLimit` → 429 problem+json dari `ConsumerRateLimitPolicy` dengan `Retry-After` + `X-RateLimit-*`.
- Restart gateway → semua consumer/key dibangun ulang dari `apiKeys` config (TRANSIENT, tidak ada persistensi).


## JWT Auth Plugin

- **Spesifikasi:** Plugin inbound bawaan `auth-jwt` yang berperan sebagai OAuth2/JWT Resource Server: memverifikasi Bearer token terhadap JWKS lokal (inline di `gateway.config.json`) tanpa dependency eksternal — hanya `node:crypto` (`createPublicKey`, `verify`).
- **Urgensi:** Gateway saat ini tidak punya auth policy bawaan. Plugin ini menjadi lapisan pertama identity & security (F7) sebelum API-Key-Engine (M3) dan Upstream-Credential-Injection (M4) menyusul.
- **Status kode:** Implemented. Plugin hook-based `auth-jwt.ts` (8 test) + policy pipeline `auth-jwt-policy.ts` (5 test), keduanya committed dan terverifikasi di suite 790/790.

### How it works

`preRoute(ctx)` dijalankan di Plugin Execution Chain sebelum routing ke upstream:
1. **Bypass**: `enabled === false` → return; path di `publicRoutes` (Set, default `/`, `/health`, `/metrics`) → return.
2. **Header spoofing guard**: strip SEMUA header inbound yang cocok `/^(x-auth-|x-user-|x-roles|x-scopes|x-email)/i` — client tidak bisa memalsukan identitas yang nanti di-inject.
3. **Ekstraksi token**: wajib header `Authorization` dengan format `Bearer <token>` (case-insensitive); token harus 3 segmen base64url (header.payload.signature).
4. **Pemilihan kunci**: `header.alg` harus `RS256` (menolak `alg=none` dan serangan HS256-confusion); `header.kid` wajib; kunci publik di-resolve dari `keyMap: Map<kid, KeyObject>` yang di-build saat konstruktor/`init()` dari `config.jwks.keys[]` (hanya `kty: RSA`, via `createPublicKey({ key: {kty,n,e}, format: 'jwk' })`).
5. **Verifikasi signature**: `verify('RSA-SHA256', Buffer.from(`${headerB64}.${payloadB64}`), publicKey, sig)` — signature base64url.
6. **Claims checks** (urutan): `exp + leeway < nowSec` → expired; `iss` === `config.issuer` (jika diset); `aud` === `config.audience` (jika diset). Leeway default 30 detik.
7. **Identity injection upstream**: setelah sukses, set `x-auth-user-id` (dari `sub`), `x-auth-scopes` (dari `scopes`/`scope`), `x-auth-aud`, `x-auth-jti`, `x-auth-exp`, `x-auth-method: bearer_jwt`.
8. **Logging aman**: sukses hanya mencatat `requestId`, `jti`, `sub`, `exp` — tidak pernah mencatat materi token.

### Configuration

Objek `AuthJwtConfig` (via `plugins[]` di `gateway.config.json`):

| Field | Tipe | Default | Keterangan |
|---|---|---|---|
| `enabled` | boolean | `true` | `false` = plugin no-op |
| `issuer` | string | `https://auth.geopulser.local` | claim `iss` yang diharapkan; kosongkan check dengan unset |
| `audience` | string | `geopulser-api` | claim `aud` yang diharapkan |
| `jwks` | `{ keys: JWK[] }` | - | JWK RSA (`kty`, `n`, `e`, `kid` wajib untuk lookup); di-parse saat boot + `init()` |
| `leewaySeconds` | number | `30` | toleransi clock skew untuk `exp` |
| `publicRoutes` | string[] | `['/', '/health', '/metrics']` | path tanpa auth (exact-match, bukan glob) |

### Edge cases

Semua gagal direspon 401 JSON `{ error: { code, message } }` + counter `metrics.recordError()`/`recordAuthFailure()` + log warn; `ctx.responded = true` (short-circuit, request tidak lanjut).

| Trigger | Code |
|---|---|
| Header `Authorization` hilang | `unauthorized` |
| Bukan format `Bearer` | `invalid_token` |
| Token bukan 3 segmen / JSON rusak | `invalid_token` |
| `alg` ≠ RS256 (termasuk `none`, HS256) | `invalid_algorithm` |
| `kid` tidak ada di header | `missing_kid` |
| `kid` tidak ada di JWKS | `unknown_kid` |
| Signature tidak valid | `invalid_signature` |
| `exp` lewat + leeway | `token_expired` |
| `iss` / `aud` mismatch | `invalid_issuer` / `invalid_audience` |

Lainnya: JWK dengan `kty` non-RSA atau tanpa `kid` dilewati `loadKeys()` (log error, tidak crash boot); path publicRoutes exact-match — `/healthz` TIDAK otomatis publik.


## RFC7807 Problem Details

Standardisasi payload error gateway ke **RFC 7807 (Problem Details for HTTP APIs)**
via helper `HttpProblems` + `createProblem`. Menggantikan hierarki `GatewayError`
+ serialisasi JSON ad-hoc dengan struktur standar: `type`, `title`, `status`,
`detail`, `instance`, `requestId`.

Implementasi: `src/pipeline/http-problems.ts` (111 baris) — nol dependensi
(`JSON.stringify` + `Response` global, `Content-Type: application/problem+json`).

(dan `npm test` 790/790 lulus, commit `99fd7d5`, M2).

### How it works

1. `CATALOG` internal: 10 error class — pasangan konstan
   `(slug, status, title)`: `bad-request` (400), `unauthorized` (401),
   `forbidden` (403), `not-found` (404), `payload-too-large` (413),
   `rate-limit-exceeded` (429), `internal-error` (500), `bad-gateway` (502),
   `service-unavailable` (503), `gateway-timeout` (504).
2. `createProblem(code, fields)` → lookup katalog, rangkai
   `{ type, title, status, detail?, instance?, requestId? }` — field opsional
   dihilangkan, bukan `null` — dan balikkan `Response` siap kirim.
   `type` = `https://gateway.internal/errors/<slug>`.
3. Helper `HttpProblems` (as-built): `badRequest`, `unauthorized`, `forbidden`,
   `notFound`, `payloadTooLarge`, `rateLimited`, `internal`, `badGateway`,
   `serviceUnavailable`, `gatewayTimeout` — masing-masing satu call.
4. `rateLimited({ detail, limit, window, retryAfterSeconds })`: `detail` default
   `"Rate limit of N requests per <window> exceeded. Try again in S seconds."`,
   header `Retry-After: <seconds>` diset bila `retryAfterSeconds` diberikan.
5. `problemToJson(problem)` — serialisasi eksplisit (field opsional di-skip).
6. Short-circuit pipeline: policy inbound mengembalikan `Response` problem →
   `RequestPipeline.runInbound` berhenti, `RequestPipeline.writeResponse`
   mengirim ke client tanpa menyentuh handler backend.

### Configuration

Tidak ada field konfigurasi. `TYPE_BASE` (`https://gateway.internal/errors`)
adalah konstanta modul — bukan config.

### Edge cases

- Slug tidak ada di katalog → `ERR_UNKNOWN_PROBLEM_SLUG` (developer-facing).
- Status di luar 400–599 → `ERR_PROBLEM_STATUS`.
- 429 tanpa info kuota: `detail` boleh kosong — payload tetap valid RFC 7807;
  `Retry-After` hanya hadir bila `retryAfterSeconds` eksplisit.
- `detail` tidak pernah menerima objek error mentah — string teks saja;
  stack trace/path internal hanya di server log.


## Upstream Credential Injection

- **Spesifikasi:** Inbound policy yang menjalankan injeksi kredensial upstream SETELAH caller terautentikasi dan SEBELUM request diteruskan ke origin. Dua policy 0-dep: `set-upstream-header` (menempel static token internal, mis. `Authorization: Bearer ***`) dan `upstream-hmac-signature` (menandatangani body request dengan shared secret sebelum dikirim ke microservice internal).
- **Urgensi:** Menutup gap "Caller Auth vs Upstream Auth" terhadap Zuplo — kredensial upstream (static token, HMAC secret) tidak boleh dipegang caller; gateway adalah satu-satunya pemegangnya. Krusial untuk BFF / enterprise microservice.

### How it works

1. **Urutan pipeline**: policy ini berjalan setelah policy autentikasi caller (JWT-Auth-Plugin / API-Key-Engine) lolos — caller tervalidasi dulu, baru gateway mempersenjatai request menuju origin.
2. **`set-upstream-header`**: konfigurasi statis `header → value` (mis. `Authorization: Bearer <internal-token>`, `x-internal-service: payments`). Header sensitif caller di-overwrite, bukan dilewati.
3. **`upstream-hmac-signature`**: hitung HMAC-SHA256 atas body request menggunakan shared secret per-upstream (`node:crypto` `createHmac`), tempelkan signature + timestamp ke header upstream (mis. `x-signature`, `x-timestamp`) — microservice internal memverifikasi bahwa request benar-benar dari gateway dan body tidak diubah.
4. **Pemisahan tegas**: caller auth (apa yang membuktikan client) ≠ upstream auth (apa yang membuktikan gateway ke origin). Gagal signature/secret hilang = fail-closed (request tidak diteruskan).

### Configuration

| Field | Tipe | Keterangan |
|---|---|---|
| `policy` | `set-upstream-header` \| `upstream-hmac-signature` | jenis injeksi |
| `headers` | Record<string,string> | static headers untuk `set-upstream-header` |
| `secretRef` | string | nama shared secret HMAC (nilai tidak inline) |
| `headerNamespace` | string | prefix header signature (mis. `x-signature`) |

### Edge cases

- Request tanpa body (GET) → HMAC dihitung atas signing input tanpa body (canonical string: method+path+timestamp).
- Header upstream sudah diisi caller → di-overwrite, tidak digandakan.
- Shared secret salah/rotate → verifikasi di microservice gagal; gateway log + metrik, tidak retry otomatis.
- Body besar → HMAC stream/hash incremental agar tidak buffer ganda.
