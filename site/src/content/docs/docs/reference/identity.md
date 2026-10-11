---
title: "Identity & Security"
description: "API key validation, HMAC signing, consumer quotas, and upstream credentials."
---

The identity module manages caller authentication, cryptographic verification, consumer rate limits, and secure upstream credential injection. It verifies inbound API keys with constant-time comparison, validates HMAC signatures on inbound webhooks, and injects upstream authorization tokens without exposing secrets to client callers. It forms the security gatekeeper for sensitive upstream endpoints.

## Exports

| Symbol | Kind | Signature | Purpose |
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

## Notes

### ApiKeyCrypto
Performs timing-attack safe comparisons of hashed consumer keys.

### ConsumerStore
Tracks authenticated consumer identities, associated plan tiers, and daily quota ceilings.

### HmacSignPolicy
Computes SHA-256 HMAC signatures over payload bodies to verify webhook integrity.

## Source

- `src/identity/api-key-crypto.ts`
- `src/identity/api-key-policy.ts`
- `src/identity/consumer-rate-limit-policy.ts`
- `src/identity/consumer-store.ts`
- `src/identity/hmac-sign-policy.ts`
- `src/identity/set-upstream-header-policy.ts`
- `src/identity/upstream-credential-store.ts`
- `src/identity/verify-inbound-hmac-policy.ts`

## See also

- [Deep Dive: Identity & Security](/docs/deep-dive/identity-security/)
