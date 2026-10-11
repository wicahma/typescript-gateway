---
title: "Definisi Tipe (Type Definitions)"
description: "Antarmuka TypeScript inti, kontrak konfigurasi, dan tipe plugin."
---

Modul tipe berisi definisi TypeScript otoritatif, antarmuka, dan kontrak tipe yang digunakan di seluruh codebase gateway. Modul ini mendefinisikan konteks permintaan, spesifikasi rute, tanda tangan plugin, model identitas, dan tata letak konfigurasi server. Tipe-tipe ini memberikan jaminan waktu kompilasi dan kenyamanan autolengkap bagi pengguna gateway.

## Ekspor (Exports)

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `ConfigFile` | interface | `interface ConfigFile extends GatewayConfig` | Configuration file format |
| `ValidationResult` | interface | `interface ValidationResult` | Configuration validation result |
| `ValidationError` | interface | `interface ValidationError` | Configuration validation error |
| `ConfigLoaderOptions` | interface | `interface ConfigLoaderOptions` | Configuration loader options |
| `ConfigChangeEvent` | interface | `interface ConfigChangeEvent` | Configuration change event |
| `ConfigWatcherCallback` | type | `type ConfigWatcherCallback = (event: ConfigChangeEvent) => void \| Promise<void>` | Configuration watcher callback |
| `{ GatewayConfig, ServerConfig, PerformanceConfig, UpstreamTarget, Route, PluginConfig }` | type | `type { GatewayConfig, ServerConfig, PerformanceConfig, UpstreamTarget, Route, PluginConfig` | Type export for { GatewayConfig, ServerConfig, PerformanceConfig, UpstreamTarget, Route, PluginConfig }. |
| `HttpMethod` | type | `type HttpMethod = 'GET' \| 'POST' \| 'PUT' \| 'DELETE' \| 'PATCH' \| 'HEAD' \| 'OPTIONS'` | HTTP methods supported by the gateway |
| `RequestContext` | interface | `interface RequestContext` | Pooled request context object This object is reused across requests to minimize allocations Enhanced with route matching |
| `RouteMatch` | interface | `interface RouteMatch` | Route match result |
| `RouteHandler` | type | `type RouteHandler = (ctx: RequestContext) => Promise<void> \| void` | Route handler function signature Handlers should be monomorphic for V8 optimization |
| `Route` | interface | `interface Route` | Route definition |
| `UpstreamTarget` | interface | `interface UpstreamTarget` | Upstream service target definition |
| `HealthCheckConfig` | interface | `interface HealthCheckConfig` | Health check configuration |
| `LoadBalancerStrategy` | type | `type LoadBalancerStrategy =` | Load balancing strategies |
| `CircuitBreakerState` | enum | `enum CircuitBreakerState` | Circuit breaker states |
| `CircuitBreakerConfig` | interface | `interface CircuitBreakerConfig` | Circuit breaker configuration |
| `WorkerMessageType` | enum | `enum WorkerMessageType` | Worker message types for master-worker communication |
| `WorkerMessage` | interface | `interface WorkerMessage` | Worker message protocol |
| `MetricsSnapshot` | interface | `interface MetricsSnapshot` | Performance metrics snapshot Designed for lock-free atomic operations |
| `ServerConfig` | interface | `interface ServerConfig` | Server configuration |
| `GatewayConfig` | interface | `interface GatewayConfig` | Gateway configuration (root) |
| `PluginConfig` | interface | `interface PluginConfig` | Plugin configuration |
| `PerformanceConfig` | interface | `interface PerformanceConfig` | Performance tuning configuration |
| `BodyParserConfig` | interface | `interface BodyParserConfig` | Body parser configuration |
| `ConnectionPoolConfig` | interface | `interface ConnectionPoolConfig` | Connection pool configuration |
| `HealthCheckType` | type | `type HealthCheckType = 'active' \| 'passive' \| 'hybrid'` | Health check type |
| `HealthStatus` | enum | `enum HealthStatus` | Health status |
| `LoadBalancerConfig` | interface | `interface LoadBalancerConfig` | Load balancer configuration |
| `MonitoringConfig` | interface | `interface MonitoringConfig` | Monitoring configuration |
| `ApiKeysConfig` | interface | `interface ApiKeysConfig` | Interface export for ApiKeysConfig. |
| `UpstreamCredentialsConfig` | interface | `interface UpstreamCredentialsConfig` | Interface export for UpstreamCredentialsConfig. |
| `WithIdentity` | interface | `interface WithIdentity extends GatewayConfig` | Interface export for WithIdentity. |
| `PluginHook` | enum | `enum PluginHook` | Plugin lifecycle hooks |
| `Plugin` | interface | `interface Plugin` | Plugin interface All plugins must implement this interface |
| `PluginMetadata` | interface | `interface PluginMetadata` | Plugin metadata |
| `PluginExecutionContext` | interface | `interface PluginExecutionContext` | Plugin execution context Used internally by plugin executor |
| `PluginStats` | interface | `interface PluginStats` | Plugin execution statistics |
| `PluginLoaderConfig` | interface | `interface PluginLoaderConfig` | Plugin loader configuration |

## Catatan (Notes)

### GatewayConfig
Kontrak skema utama yang mendeskripsikan port server, upstream pool, rute, dan plugin.

### GatewayContext
Konteks eksekusi yang diteruskan melalui router, kebijakan, dan plugin.

### Plugin
Kontrak siklus hidup yang mendefinisikan hook penanganan `onRequest`, `onResponse`, dan `onError`.

## Sumber (Source)

- `src/types/config.ts`
- `src/types/core.ts`
- `src/types/identity.ts`
- `src/types/plugin.ts`

## Lihat juga (See also)

- [Pendalaman: Arsitektur](/id/docs/deep-dive/architecture/)
