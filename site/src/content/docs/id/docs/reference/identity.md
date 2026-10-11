---
title: "Identitas & Keamanan (Identity & Security)"
description: "Validasi API key, tanda tangan HMAC, kuota konsumen, dan kredensial upstream."
---

Modul identitas mengelola autentikasi pemanggil, verifikasi kriptografis, rate limit konsumen, dan penyuntikan kredensial upstream yang aman. Modul ini memverifikasi API key masuk dengan perbandingan waktu konstan, memvalidasi tanda tangan HMAC pada webhook masuk, dan menyuntikkan token otorisasi upstream tanpa mengekspos rahasia ke klien luar. Ini membentuk gerbang keamanan utama bagi endpoint upstream yang sensitif.

## Ekspor (Exports)

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `crc32` | function | `function crc32(input: string): number` | Function export for crc32. |
| `checksum4` | function | `function checksum4(input: string): string` | Function export for checksum4. |
| `API_KEY_FORMAT` | const | `const API_KEY_FORMAT = /^tsgk_[a-z0-9-]{1,16}_[A-Za-z0-9]{32}_[0-9a-f]{4}$/` | Const export for API_KEY_FORMAT. |
| `BUCKET_FORMAT` | const | `const BUCKET_FORMAT = /^[a-z0-9-]{1,16}$/` | Const export for BUCKET_FORMAT. |
| `generateApiKey` | function | `function generateApiKey(bucket: string): string` | Function export for generateApiKey. |
| `validateFormat` | function | `function validateFormat(key: string): boolean` | Function export for validateFormat. |
| `parseApiKey` | function | `function parseApiKey(key: string): { bucket: string; random32: string; checksum: string } ` | Function export for parseApiKey. |
| `verifyChecksum` | function | `function verifyChecksum(key: string): boolean` | Function export for verifyChecksum. |
| `hashKey` | function | `function hashKey(key: string): string` | Function export for hashKey. |
| `ApiKeyPolicyConfig` | interface | `interface ApiKeyPolicyConfig` | Interface export for ApiKeyPolicyConfig. |
| `ApiKeyPolicy` | class | `class ApiKeyPolicy implements GatewayPolicy` | Class export for ApiKeyPolicy. |
| `ConsumerRateLimitPolicyConfig` | interface | `interface ConsumerRateLimitPolicyConfig` | Interface export for ConsumerRateLimitPolicyConfig. |
| `ConsumerRateLimitPolicy` | class | `class ConsumerRateLimitPolicy implements GatewayPolicy` | Class export for ConsumerRateLimitPolicy. |
| `ConsumerRecord` | interface | `interface ConsumerRecord` | Interface export for ConsumerRecord. |
| `ApiKeyRecord` | interface | `interface ApiKeyRecord` | Interface export for ApiKeyRecord. |
| `ConsumerStore` | class | `class ConsumerStore` | Class export for ConsumerStore. |
| `HmacSignPolicyConfig` | interface | `interface HmacSignPolicyConfig` | Interface export for HmacSignPolicyConfig. |
| `verifyHmacSignature` | function | `function verifyHmacSignature(` | Function export for verifyHmacSignature. |
| `HmacSignPolicy` | class | `class HmacSignPolicy implements GatewayPolicy` | Class export for HmacSignPolicy. |
| `SetUpstreamHeaderPolicyConfig` | interface | `interface SetUpstreamHeaderPolicyConfig` | Interface export for SetUpstreamHeaderPolicyConfig. |
| `SetUpStreamHeaderPolicy` | class | `class SetUpStreamHeaderPolicy implements GatewayPolicy` | Class export for SetUpStreamHeaderPolicy. |
| `UpstreamCredential` | interface | `interface UpstreamCredential` | Interface export for UpstreamCredential. |
| `UpstreamCredentialStore` | class | `class UpstreamCredentialStore` | Class export for UpstreamCredentialStore. |
| `VerifyInboundHmacConfig` | interface | `interface VerifyInboundHmacConfig` | Interface export for VerifyInboundHmacConfig. |
| `VerifyInboundHmacPolicy` | class | `class VerifyInboundHmacPolicy implements GatewayPolicy` | Class export for VerifyInboundHmacPolicy. |

## Catatan (Notes)

### ApiKeyCrypto
Melakukan perbandingan hash kunci konsumen yang aman dari serangan timing attack.

### ConsumerStore
Melacak identitas konsumen yang terautentikasi, tingkatan paket terkait, dan batas kuota harian.

### HmacSignPolicy
Menghitung tanda tangan HMAC SHA-256 pada body payload untuk memverifikasi integritas webhook.

## Sumber (Source)

- `src/identity/api-key-crypto.ts`
- `src/identity/api-key-policy.ts`
- `src/identity/consumer-rate-limit-policy.ts`
- `src/identity/consumer-store.ts`
- `src/identity/hmac-sign-policy.ts`
- `src/identity/set-upstream-header-policy.ts`
- `src/identity/upstream-credential-store.ts`
- `src/identity/verify-inbound-hmac-policy.ts`

## Lihat juga (See also)

- [Pendalaman: Identitas & Keamanan](/id/docs/deep-dive/identity-security/)
