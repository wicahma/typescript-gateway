---
title: "Sistem Plugin (Plugin System)"
description: "Rantai eksekusi plugin, hook siklus hidup, dan kebijakan middleware bawaan."
---

Modul plugin menyediakan kerangka kerja ekstensi dan implementasi middleware bawaan untuk gateway. Modul ini menangani pendaftaran plugin asinkron, pengurutan dependensi, dan hook siklus hidup eksekusi di seluruh fase persiapan permintaan dan mutasi respons. Plugin bawaan mencakup verifikasi JWT, pembuatan request ID, logging terstruktur, dan pengukuran waktu respons.

## Ekspor (Exports)

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `PluginNamespace` | interface | `interface PluginNamespace` | Plugin data namespace Prevents naming collisions between plugins |
| `PluginEvent` | interface | `interface PluginEvent` | Plugin event for cross-plugin communication |
| `PluginEventListener` | type | `type PluginEventListener = (event: PluginEvent) => void \| Promise<void>` | Plugin event listener |
| `PluginContextManager` | class | `class PluginContextManager` | Plugin context manager Enhances request context with namespaced plugin data storage |
| `createPluginContextManager` | function | `function createPluginContextManager(): PluginContextManager` | Create plugin context manager instance |
| `pluginContextManager` | const | `const pluginContextManager = createPluginContextManager()` | Global plugin context manager instance |
| `PluginExecutionOptions` | interface | `interface PluginExecutionOptions` | Plugin execution options |
| `PluginExecutionResult` | interface | `interface PluginExecutionResult` | Plugin execution result |
| `PluginExecutionChain` | class | `class PluginExecutionChain` | Optimized plugin execution chain Handles plugin lifecycle with timeouts, metrics, and error boundaries |
| `createPluginExecutionChain` | function | `function createPluginExecutionChain(` | Create plugin execution chain instance |
| `PluginLoader` | class | `class PluginLoader` | Plugin loader class |
| `createPluginLoader` | function | `function createPluginLoader(config: PluginLoaderConfig): PluginLoader` | Create plugin loader instance |
| `PluginMetrics` | interface | `interface PluginMetrics` | Plugin execution metrics |
| `PluginMetricsCollector` | class | `class PluginMetricsCollector` | Plugin metrics collector Collects and aggregates plugin execution metrics |
| `pluginMetricsCollector` | const | `const pluginMetricsCollector = new PluginMetricsCollector()` | Global plugin metrics collector instance |
| `AuthJwtPolicyConfig` | interface | `interface AuthJwtPolicyConfig` | Interface export for AuthJwtPolicyConfig. |
| `AuthJwtPolicy` | class | `class AuthJwtPolicy implements GatewayPolicy` | Class export for AuthJwtPolicy. |
| `JWK` | interface | `interface JWK` | Interface export for JWK. |
| `AuthJwtConfig` | interface | `interface AuthJwtConfig` | Interface export for AuthJwtConfig. |
| `AuthJwtPlugin` | class | `class AuthJwtPlugin implements Plugin` | Class export for AuthJwtPlugin. |
| `HeaderRule` | interface | `interface HeaderRule` | Header transformation rule |
| `HeaderTransformerConfig` | interface | `interface HeaderTransformerConfig` | Header transformer plugin configuration |
| `HeaderTransformerPlugin` | class | `class HeaderTransformerPlugin implements Plugin` | Header Transformer Plugin Adds, removes, or modifies headers based on configurable rules |
| `createHeaderTransformerPlugin` | function | `function createHeaderTransformerPlugin(` | Create header transformer plugin instance |
| `{ AuthJwtPolicyConfig }` | type | `type { AuthJwtPolicyConfig } from './auth-jwt-policy.js'` | Type export for { AuthJwtPolicyConfig }. |
| `RateLimitStrategyType` | type | `type RateLimitStrategyType = 'token-bucket' \| 'sliding-window'` | Rate limit strategy type |
| `KeyExtractor` | type | `type KeyExtractor = 'ip' \| 'header' \| 'upstream' \| 'consumer'` | Key extractor type |
| `RateLimitStrategy` | interface | `interface RateLimitStrategy` | Rate limit strategy configuration |
| `RateLimitConfig` | interface | `interface RateLimitConfig` | Rate limit plugin configuration |
| `RateLimitPlugin` | class | `class RateLimitPlugin implements Plugin` | Rate limit plugin Implements multiple rate limiting strategies |
| `createRateLimitPlugin` | function | `function createRateLimitPlugin(config?: Partial<RateLimitConfig>): RateLimitPlugin` | Create rate limit plugin instance |
| `RequestIdConfig` | interface | `interface RequestIdConfig` | Request ID plugin configuration |
| `RequestIdPlugin` | class | `class RequestIdPlugin implements Plugin` | Request ID Plugin Generates unique request IDs for tracing and correlation |
| `createRequestIdPlugin` | function | `function createRequestIdPlugin(config?: Partial<RequestIdConfig>): RequestIdPlugin` | Create request ID plugin instance |
| `RequestLoggerConfig` | interface | `interface RequestLoggerConfig` | Request logger plugin configuration |
| `RequestLoggerPlugin` | class | `class RequestLoggerPlugin implements Plugin` | Request Logger Plugin Provides structured logging of HTTP requests with configurable fields |
| `createRequestLoggerPlugin` | function | `function createRequestLoggerPlugin(` | Create request logger plugin instance |
| `ResponseTimeConfig` | interface | `interface ResponseTimeConfig` | Response time plugin configuration |
| `ResponseTimePlugin` | class | `class ResponseTimePlugin implements Plugin` | Response Time Plugin Tracks request processing time and adds header with duration |
| `createResponseTimePlugin` | function | `function createResponseTimePlugin(config?: Partial<ResponseTimeConfig>): ResponseTimePlugi` | Create response time plugin instance |

## Catatan (Notes)

### ExecutionChain
Mengelola pemanggilan asinkron plugin sambil mengisolasi error untuk mencegah crash worker.

### PluginLoader
Memuat dan memvalidasi modul plugin eksternal secara dinamis terhadap antarmuka kontrak.

### BuiltinPlugins
Implementasi bawaan tanpa dependensi yang dioptimalkan untuk kemampuan gateway umum seperti rate limiting dan decoding JWT.

## Sumber (Source)

- `src/plugins/context-manager.ts`
- `src/plugins/execution-chain.ts`
- `src/plugins/loader.ts`
- `src/plugins/metrics.ts`
- `src/plugins/builtin/auth-jwt-policy.ts`
- `src/plugins/builtin/auth-jwt.ts`
- `src/plugins/builtin/header-transformer.ts`
- `src/plugins/builtin/index.ts`
- `src/plugins/builtin/rate-limit-plugin.ts`
- `src/plugins/builtin/request-id.ts`
- `src/plugins/builtin/request-logger.ts`
- `src/plugins/builtin/response-time.ts`

## Lihat juga (See also)

- [Pendalaman: Operasional](/id/docs/deep-dive/operations/)
- [Pendalaman: Fitur](/id/docs/deep-dive/features/)
