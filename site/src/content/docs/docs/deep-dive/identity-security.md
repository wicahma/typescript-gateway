---
title: "Identity & Security"
description: "JWT auth, API-key engine, upstream credential injection, RFC 7807 errors."
---

Every feature in this group is **implemented and verified**, each with unit and integration coverage in the repo test suite.

## What It Does

The identity and security subsystem provides caller authentication, dynamic per-consumer authorization, credential stripping, RFC 7807 standardized error formatting, and upstream credential injection without external dependencies.

### API Key Engine

A high-performance consumer identity and token engine:
- **Token Format**: `tsgk_<bucket>_<random32>_<checksum4>` containing an environment bucket, 32-character base62 random token, and a CRC32 checksum for O(1) typo rejection.
- **Tiered Verification**: Fast format regex -> constant-time checksum evaluation -> LRU/TTL cache lookup -> consumer store verification.
- **Context Injection**: Sets `ctx.state['user'] = { sub: consumerId, data: { plan, rateLimit } }` to drive consumer-aware rate limits and quota enforcement.

### JWT Auth Plugin

An OAuth2/JWT Resource Server built purely on `node:crypto`:
- **Cryptographic Validation**: Validates RS256 signatures against inline JSON Web Key Sets (JWKS).
- **Claims Enforcement**: Enforces `iss`, `aud`, and `exp` with configurable clock skew tolerance (`leewaySeconds`).
- **Spoofing Guard**: Strips all inbound headers matching `/^(x-auth-|x-user-|x-roles|x-scopes|x-email)/i` before upstream forwarding.

### RFC 7807 Problem Details

Standardizes API error responses into RFC 7807 compliant payloads:
- **Consistent Structure**: Returns `type`, `title`, `status`, `detail`, `instance`, and `requestId` with `Content-Type: application/problem+json`.
- **Predefined Catalog**: Covers common HTTP error states (400, 401, 403, 404, 413, 429, 500, 502, 503, 504).

### Upstream Credential Injection

Isolates backend authorization from external clients:
- **Header Injection (`set-upstream-header`)**: Injects internal tokens or service identification headers after caller authentication succeeds.
- **HMAC Signatures (`upstream-hmac-signature`)**: Signs request payloads using HMAC-SHA256 with shared secret keys, providing origin authenticity verification for microservices.

## Configuration

Identity and security features are configured in `gateway.config.json`:

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `apiKeys.enabled` | boolean | `false` | Enables API key validation policy. |
| `apiKeys.headerName` | string | `"x-api-key"` | Header name used to extract API keys. |
| `apiKeys.cacheTtlSeconds` | number | `5` | Validation cache TTL (upper bound on revocation delay). |
| `apiKeys.cacheMaxEntries` | number | `10000` | Maximum capacity of the API key cache. |
| `apiKeys.consumers[].consumerId` | string | — | Unique consumer identity string. |
| `apiKeys.consumers[].rateLimit` | number | — | Inbound request quota per minute for this consumer. |
| `plugins[auth-jwt].issuer` | string | — | Expected `iss` claim in JWT payloads. |
| `plugins[auth-jwt].audience` | string | — | Expected `aud` claim in JWT payloads. |
| `plugins[auth-jwt].jwks.keys` | array | `[]` | RSA public keys in JWK format. |
| `plugins[auth-jwt].leewaySeconds` | number | `30` | Allowed clock-skew window in seconds. |

## Interactions

Security mechanisms execute strictly in sequence at the front of the pipeline:

1. **Header Sanitization**: Inbound `x-auth-*` and spoofable identity headers are stripped from the incoming request.
2. **Caller Authentication**: JWT validation or API key policies verify the token and populate `ctx.state['user']`.
3. **Consumer Rate Limiting**: If consumer quotas are active, the pipeline verifies remaining bucket tokens using the authenticated consumer ID.
4. **Credential Injection**: Gateway attaches backend tokens or HMAC signatures to request headers.
5. **Proxy Forwarding**: Forwarded requests arrive at upstream origins with authentic gateway credentials and sanitized headers.
6. **Error Interception**: Any validation failure halts the pipeline immediately and formats an RFC 7807 Problem Details response.

## Tradeoffs and Failure Modes

- **Cache TTL vs Revocation Lag**: Caching validated API keys for 5 seconds dramatically increases throughput by skipping repeated hashing, but introduces up to a 5-second window where a revoked key remains authorized.
- **In-Memory Consumers**: The default consumer store operates entirely in-memory; restarting the gateway reloads consumers from the configuration file, discarding dynamic state unless backed by persistent configuration.
- **JWT Alg Restrictions**: Only RS256 asymmetric signatures are supported by default to explicitly guard against `alg=none` and HMAC/RSA key-confusion vulnerabilities.
- **Safe Error Emission**: RFC 7807 responses never leak stack traces or internal environment variables to clients; detailed diagnostics are routed exclusively to internal access logs.
