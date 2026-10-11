---
title: "Pipeline Permintaan (Request Pipeline)"
description: "Rantai middleware, kebijakan audit, CORS, keamanan, dan manajemen beban."
---

Modul pipeline mendefinisikan urutan eksekusi middleware dan kebijakan tata kelola HTTP khusus. Modul ini mengevaluasi request terhadap ambang batas load shedding, standar preflight CORS, propagasi trace context, dan isolasi keamanan. Pipeline beroperasi sebagai model lapisan dua arah deterministik yang membungkus penerus upstream.

## Ekspor (Exports)

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `AuditEvent` | interface | `interface AuditEvent` | Interface export for AuditEvent. |
| `AuditPolicyConfig` | interface | `interface AuditPolicyConfig` | Interface export for AuditPolicyConfig. |
| `AuditPolicy` | class | `class AuditPolicy implements GatewayPolicy` | Class export for AuditPolicy. |
| `CorsConfig` | interface | `interface CorsConfig` | Interface export for CorsConfig. |
| `CorsPolicy` | class | `class CorsPolicy implements GatewayPolicy` | Class export for CorsPolicy. |
| `ProblemFields` | interface | `interface ProblemFields` | Interface export for ProblemFields. |
| `ProblemDetails` | interface | `interface ProblemDetails` | Interface export for ProblemDetails. |
| `createProblem` | function | `function createProblem(code: string, fields: ProblemFields = {}): Response` | Function export for createProblem. |
| `problemToJson` | function | `function problemToJson(problem: ProblemDetails): string` | Function export for problemToJson. |
| `HttpProblems` | const | `const HttpProblems =` | Const export for HttpProblems. |
| `IdempotencyConfig` | interface | `interface IdempotencyConfig` | Interface export for IdempotencyConfig. |
| `IdempotencyPolicy` | class | `class IdempotencyPolicy implements GatewayPolicy` | Class export for IdempotencyPolicy. |
| `LoadShedPolicy` | class | `class LoadShedPolicy implements GatewayPolicy` | Class export for LoadShedPolicy. |
| `OutboundResponse` | interface | `interface OutboundResponse` | Interface export for OutboundResponse. |
| `GatewayPolicy` | interface | `interface GatewayPolicy` | Interface export for GatewayPolicy. |
| `PluginPolicy` | class | `class PluginPolicy implements GatewayPolicy` | Class export for PluginPolicy. |
| `isPlugin` | function | `function isPlugin(value: unknown): value is Plugin` | Function export for isPlugin. |
| `RecordPolicyConfig` | interface | `interface RecordPolicyConfig` | Interface export for RecordPolicyConfig. |
| `RecordPolicy` | class | `class RecordPolicy implements GatewayPolicy` | Class export for RecordPolicy. |
| `RecordedExchange` | interface | `interface RecordedExchange` | Interface export for RecordedExchange. |
| `RecordStore` | class | `class RecordStore` | Class export for RecordStore. |
| `ReplayPolicyConfig` | interface | `interface ReplayPolicyConfig` | Interface export for ReplayPolicyConfig. |
| `ReplayPolicy` | class | `class ReplayPolicy implements GatewayPolicy` | Class export for ReplayPolicy. |
| `RequestPipeline` | class | `class RequestPipeline` | Class export for RequestPipeline. |
| `SecretMaskConfig` | interface | `interface SecretMaskConfig` | Interface export for SecretMaskConfig. |
| `SecretMaskPolicy` | class | `class SecretMaskPolicy implements GatewayPolicy` | Class export for SecretMaskPolicy. |
| `SecurityHeadersConfig` | interface | `interface SecurityHeadersConfig` | Interface export for SecurityHeadersConfig. |
| `SecurityHeadersPolicy` | class | `class SecurityHeadersPolicy implements GatewayPolicy` | Class export for SecurityHeadersPolicy. |
| `ShadowPolicyConfig` | interface | `interface ShadowPolicyConfig` | Interface export for ShadowPolicyConfig. |
| `ShadowStats` | interface | `interface ShadowStats` | Interface export for ShadowStats. |
| `ShadowPolicy` | class | `class ShadowPolicy implements GatewayPolicy` | Class export for ShadowPolicy. |
| `SsrfGuardConfig` | interface | `interface SsrfGuardConfig` | Interface export for SsrfGuardConfig. |
| `isPrivateHost` | function | `function isPrivateHost(host: string, opts: { blockLinkLocal: boolean }): boolean` | Function export for isPrivateHost. |
| `SsrfGuardPolicy` | class | `class SsrfGuardPolicy implements GatewayPolicy` | Class export for SsrfGuardPolicy. |
| `StickySessionConfig` | interface | `interface StickySessionConfig` | Interface export for StickySessionConfig. |
| `StickySessionPolicy` | class | `class StickySessionPolicy implements GatewayPolicy` | Class export for StickySessionPolicy. |
| `TraceContextPolicy` | class | `class TraceContextPolicy implements GatewayPolicy` | Class export for TraceContextPolicy. |

## Catatan (Notes)

### RequestPipeline
Mengeksekusi kebijakan terdaftar dalam urutan fase ketat: pra-perutean, autentikasi, transformasi, dan eksekusi upstream.

### HttpProblems
Menstandarkan payload kesalahan RFC 7807 dan RFC 9457 di semua kebijakan yang memotong alur request.

### LoadShedPolicy
Memantau latensi P95 dan menolak kelebihan trafik dengan status 503 Problem Details saat kapasitas sistem habis.

## Sumber (Source)

- `src/pipeline/audit-policy.ts`
- `src/pipeline/cors-policy.ts`
- `src/pipeline/http-problems.ts`
- `src/pipeline/idempotency-policy.ts`
- `src/pipeline/load-shed-policy.ts`
- `src/pipeline/policy.ts`
- `src/pipeline/record-policy.ts`
- `src/pipeline/record-store.ts`
- `src/pipeline/replay-policy.ts`
- `src/pipeline/request-pipeline.ts`
- `src/pipeline/secret-mask-policy.ts`
- `src/pipeline/security-headers-policy.ts`
- `src/pipeline/shadow-policy.ts`
- `src/pipeline/ssrf-guard-policy.ts`
- `src/pipeline/sticky-session-policy.ts`
- `src/pipeline/trace-context-policy.ts`

## Lihat juga (See also)

- [Pendalaman: Kontrol Trafik](/id/docs/deep-dive/traffic-control/)
- [Pendalaman: Paket Fitur](/id/docs/deep-dive/feature-pack/)
