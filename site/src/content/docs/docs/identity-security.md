---
title: "Identity & Security"
description: "JWT auth, API-key engine, upstream credential injection, RFC 7807 errors."
order: 10
section: "Features"
track: "reference"
---

All 4 features in this group are **implemented and verified** — each has a full FSD + ERD spec pair and unit/integration coverage in the repo test suite.

## API Key Engine

- **Spec:** A built-in API-key engine in the Zuplo style but with 0 dependencies, built on `node:crypto`: a key generator with the format `tsgk_<bucket>_<random32>_<checksum4>`, tiered validation (format → checksum → cache), and consumer-state injection into the request context.
- **Why it matters:** Closes the "Authentication & Identity" gap vs Zuplo — without it the gateway has no consumer identity model, and the rate limiter can't be dynamic per tier/plan. It is the basis for per-customer rate limiting (M3, done) and upstream injection (M4).

### How it works

1. **Generate** (`generateApiKey`): the engine creates `tsgk_<bucket>_<random32>_<checksum4>` — bucket is the key scope/environment (e.g. `live`, `test`, regex `^[a-z0-9-]{1,16}$`), random32 = 24 bytes from `crypto.randomBytes` encoded as **32-character base62**, checksum4 = last 4 hex chars of a **CRC32 (256-entry table)** over the preceding part (typo detection). The plaintext is displayed once; only the sha256 hash is stored (`hashKey`).
2. **Tiered validation** (cheap first, expensive last) — the flow in `ApiKeyPolicy`:
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
3. **Consumer state injection**: valid key → set `ctx.state['user'] = { sub: consumerId, data: { plan, rateLimit } }` — structurally identical to Zuplo's `request.user` (`sub`, `data`).
4. **Per-consumer rate limiting**: `ConsumerRateLimitPolicy` reads `ctx.state['user'].data.rateLimit`, builds a token bucket per `sub` (refill `rateLimit/60` per second), and returns a 429 problem+json + `Retry-After` and `X-RateLimit-Limit`/`X-RateLimit-Remaining` headers when exhausted. `RateLimitPlugin` also has a `'consumer'` keyExtractor that reads `ctx.state['user'].sub`.

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

| Field | Type | Notes |
|---|---|---|
| `enabled` | boolean | must be `true` + at least 1 consumer for the policy to be registered |
| `publicRoutes` | string[] | routes without auth (default `["/", "/health", "/metrics"]`) |
| `headerName` | string | key header (default `x-api-key`; fallback `Authorization: ***`) |
| `cacheTtlSeconds` | number | validation-cache TTL (default 5) — upper bound on effective revoke delay |
| `cacheMaxEntries` | number | LRU cache capacity (default 10000) |
| `consumers[].consumerId` | string | unique consumer ID |
| `consumers[].plan` | string | plan tier (default `free`) |
| `consumers[].rateLimit` | number | req/min for the per-consumer token bucket |
| `consumers[].keys[].key` | string | plaintext key (config/boot only, never cached or logged) |
| `consumers[].keys[].expiresAt` | number? | epoch ms; once passed → 401 expired |

### Edge cases

- Wrong prefix/format key → rejected O(1) without store access.
- Checksum mismatch → rejected timing-safe (typos/corrupted transmission) without a cache lookup.
- Valid but revoked key → the cache TTL makes revocation effective at most after the TTL expires (default 5 seconds).
- Key past `expiresAt` → 401 `'API key has expired'` (from `ERR_KEY_EXPIRED`).
- Consumer exceeding `rateLimit` → 429 problem+json from `ConsumerRateLimitPolicy` with `Retry-After` + `X-RateLimit-*`.
- Gateway restart → all consumers/keys are rebuilt from the `apiKeys` config (TRANSIENT, no persistence).


## JWT Auth Plugin

- **Spec:** The built-in inbound plugin `auth-jwt` acting as an OAuth2/JWT Resource Server: verifies Bearer tokens against a local JWKS (inline in `gateway.config.json`) without external dependencies — only `node:crypto` (`createPublicKey`, `verify`).
- **Why it matters:** The gateway currently has no built-in auth policy. This plugin is the first identity & security layer before API keys and upstream credential injection followed.
- **Status:** Implemented. The hook-based plugin `auth-jwt.ts` (8 tests) + the policy pipeline `auth-jwt-policy.ts` (5 tests), both committed and verified in the 790/790 suite.

### How it works

`preRoute(ctx)` runs in the Plugin Execution Chain before routing to the upstream:
1. **Bypass**: `enabled === false` → return; path in `publicRoutes` (a Set, default `/`, `/health`, `/metrics`) → return.
2. **Header spoofing guard**: strips ALL inbound headers matching `/^(x-auth-|x-user-|x-roles|x-scopes|x-email)/i` — clients cannot forge the identity that will be injected later.
3. **Token extraction**: requires an `Authorization` header with format `Bearer <token>` (case-insensitive); the token must be 3 base64url segments (header.payload.signature).
4. **Key selection**: `header.alg` must be `RS256` (rejecting `alg=none` and HS256-confusion attacks); `header.kid` required; the public key is resolved from the `keyMap: Map<kid, KeyObject>` built in the constructor/`init()` from `config.jwks.keys[]` (only `kty: RSA`, via `createPublicKey({ key: {kty,n,e}, format: 'jwk' })`).
5. **Signature verification**: `verify('RSA-SHA256', Buffer.from(`${headerB64}.${payloadB64}`), publicKey, sig)` — base64url signature.
6. **Claims checks** (in order): `exp + leeway < nowSec` → expired; `iss` === `config.issuer` (if set); `aud` === `config.audience` (if set). Default leeway is 30 seconds.
7. **Upstream identity injection**: after success, set `x-auth-user-id` (from `sub`), `x-auth-scopes` (from `scopes`/`scope`), `x-auth-aud`, `x-auth-jti`, `x-auth-exp`, `x-auth-method: bearer_jwt`.
8. **Safe logging**: success only logs `requestId`, `jti`, `sub`, `exp` — never token material.

### Configuration

The `AuthJwtConfig` object (via `plugins[]` in `gateway.config.json`):

| Field | Type | Default | Notes |
|---|---|---|---|
| `enabled` | boolean | `true` | `false` = no-op plugin |
| `issuer` | string | `https://auth.geopulser.local` | expected `iss` claim; unset skips the check |
| `audience` | string | `geopulser-api` | expected `aud` claim |
| `jwks` | `{ keys: JWK[] }` | - | RSA JWK (`kty`, `n`, `e`, `kid` required for lookup); parsed at boot + `init()` |
| `leewaySeconds` | number | `30` | clock-skew tolerance for `exp` |
| `publicRoutes` | string[] | `['/', '/health', '/metrics']` | paths without auth (exact-match, not glob) |

### Edge cases

All failures respond 401 JSON `{ error: { code, message } }` + `metrics.recordError()`/`recordAuthFailure()` counters + a warn log; `ctx.responded = true` (short-circuit, the request doesn't continue).

| Trigger | Code |
|---|---|
| `Authorization` header missing | `unauthorized` |
| Not `Bearer` format | `invalid_token` |
| Token not 3 segments / broken JSON | `invalid_token` |
| `alg` ≠ RS256 (including `none`, HS256) | `invalid_algorithm` |
| `kid` missing from the header | `missing_kid` |
| `kid` not in the JWKS | `unknown_kid` |
| Invalid signature | `invalid_signature` |
| `exp` past + leeway | `token_expired` |
| `iss` / `aud` mismatch | `invalid_issuer` / `invalid_audience` |

Others: a JWK with non-RSA `kty` or without `kid` is skipped in `loadKeys()` (error log, boot doesn't crash); publicRoutes paths are exact-match — `/healthz` is NOT automatically public.


## RFC7807 Problem Details

Standardizes the gateway's error payloads to **RFC 7807 (Problem Details for HTTP APIs)**
via the `HttpProblems` helper + `createProblem`. It replaces the `GatewayError`
hierarchy + ad-hoc JSON serialization with a standard structure: `type`, `title`, `status`,
`detail`, `instance`, `requestId`.

Implementation: `src/pipeline/http-problems.ts` (111 lines) — zero dependencies
(`JSON.stringify` + the global `Response`, `Content-Type: application/problem+json`).

(and `npm test` 790/790 passing, commit `99fd7d5`, M2).

### How it works

1. Internal `CATALOG`: 10 error classes — constant tuples
   `(slug, status, title)`: `bad-request` (400), `unauthorized` (401),
   `forbidden` (403), `not-found` (404), `payload-too-large` (413),
   `rate-limit-exceeded` (429), `internal-error` (500), `bad-gateway` (502),
   `service-unavailable` (503), `gateway-timeout` (504).
2. `createProblem(code, fields)` → catalog lookup, assembles
   `{ type, title, status, detail?, instance?, requestId? }` — optional fields
   are omitted, not `null` — and returns a sendable `Response`.
   `type` = `https://gateway.internal/errors/<slug>`.
3. The `HttpProblems` helpers (as-built): `badRequest`, `unauthorized`, `forbidden`,
   `notFound`, `payloadTooLarge`, `rateLimited`, `internal`, `badGateway`,
   `serviceUnavailable`, `gatewayTimeout` — each a single call.
4. `rateLimited({ detail, limit, window, retryAfterSeconds })`: the default `detail`
   is `"Rate limit of N requests per <window> exceeded. Try again in S seconds."`,
   the `Retry-After: <seconds>` header is set when `retryAfterSeconds` is given.
5. `problemToJson(problem)` — explicit serialization (optional fields skipped).
6. Pipeline short-circuit: an inbound policy returning a problem `Response` →
   `RequestPipeline.runInbound` stops, `RequestPipeline.writeResponse`
   sends it to the client without touching the backend handler.

### Configuration

No configuration fields. `TYPE_BASE` (`https://gateway.internal/errors`)
is a module constant — not config.

### Edge cases

- Slug not in the catalog → `ERR_UNKNOWN_PROBLEM_SLUG` (developer-facing).
- Status outside 400–599 → `ERR_PROBLEM_STATUS`.
- 429 without quota info: `detail` may be empty — the payload remains valid RFC 7807;
  `Retry-After` is only present when `retryAfterSeconds` is explicit.
- `detail` never receives a raw error object — text strings only;
  stack traces/internal paths go to server logs only.


## Upstream Credential Injection

- **Spec:** An inbound policy that performs upstream credential injection AFTER the caller is authenticated and BEFORE the request is forwarded to the origin. Two 0-dep policies: `set-upstream-header` (attaches a static internal token, e.g. `Authorization: Bearer ***`) and `upstream-hmac-signature` (signs the request body with a shared secret before it is sent to internal microservices).
- **Why it matters:** Closes the "Caller Auth vs Upstream Auth" gap vs Zuplo — upstream credentials (static tokens, HMAC secrets) must never be held by the caller; the gateway is the sole holder. Crucial for BFF / enterprise microservices.

### How it works

1. **Pipeline order**: these policies run after caller-authentication policies (JWT-Auth-Plugin / API-Key-Engine) pass — the caller is validated first, then the gateway arms the request toward the origin.
2. **`set-upstream-header`**: static `header → value` configuration (e.g. `Authorization: Bearer <inter...n>`, `x-internal-service: payments`). Sensitive caller headers are overwritten, not skipped.
3. **`upstream-hmac-signature`**: computes HMAC-SHA256 over the request body using a per-upstream shared secret (`node:crypto` `createHmac`), attaches the signature + timestamp to upstream headers (e.g. `x-signature`, `x-timestamp`) — internal microservices verify that the request genuinely came from the gateway and the body wasn't altered.
4. **Strict separation**: caller auth (what proves the client) ≠ upstream auth (what proves the gateway to the origin). Signature failure / missing secret = fail-closed (the request is not forwarded).

### Configuration

| Field | Type | Notes |
|---|---|---|
| `policy` | `set-upstream-header` \| `upstream-hmac-signature` | injection type |
| `headers` | Record<string,string> | static headers for `set-upstream-header` |
| `secretRef` | string | name of the shared HMAC secret (value never inline) |
| `headerNamespace` | string | signature header prefix (e.g. `x-signature`) |

### Edge cases

- Request without a body (GET) → the HMAC is computed over a signing input without the body (canonical string: method+path+timestamp).
- Upstream header already set by the caller → overwritten, never duplicated.
- Wrong/rotated shared secret → verification fails at the microservice; the gateway logs + records metrics, no automatic retry.
- Large body → incremental HMAC stream/hash to avoid double buffering.
