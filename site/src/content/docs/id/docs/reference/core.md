---
title: "Mesin Inti (Core Engine)"
description: "Server HTTP, perutean radix, connection pool, proksi, dan cache respons."
---

Modul inti mencakup mesin eksekusi HTTP utama, primitif konteks permintaan, router pohon radix, dan connection pooling upstream. Modul ini mengelola koneksi soket, mengurai payload HTTP yang masuk, dan mengoordinasikan penerusan upstream tanpa dependensi eksternal. Setiap koneksi masuk melewati lapisan ini secara langsung sebelum mencapai kebijakan tingkat tinggi.

## Ekspor (Exports)

### `src/core/advanced-metrics.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `TransformationMetrics` | interface | `interface TransformationMetrics` | Transformation metrics |
| `CompressionMetrics` | interface | `interface CompressionMetrics` | Compression metrics |
| `WebSocketMetrics` | interface | `interface WebSocketMetrics` | WebSocket metrics |
| `RouteMetrics` | interface | `interface RouteMetrics` | Per-route metrics |
| `UpstreamMetrics` | interface | `interface UpstreamMetrics` | Per-upstream metrics |
| `ErrorMetrics` | interface | `interface ErrorMetrics` | Error metrics by category |
| `ErrorRateMetrics` | interface | `interface ErrorRateMetrics` | Error rate metrics for |
| `TimeWindowMetrics` | interface | `interface TimeWindowMetrics` | Time window metrics |
| `RouteErrorRate` | interface | `interface RouteErrorRate` | Route error rate |
| `UpstreamErrorRate` | interface | `interface UpstreamErrorRate` | Upstream error rate |
| `RetryStatistics` | interface | `interface RetryStatistics` | Retry statistics for |
| `UpstreamRetryStats` | interface | `interface UpstreamRetryStats` | Upstream retry statistics |
| `TimeoutMetrics` | interface | `interface TimeoutMetrics` | Timeout metrics for |
| `RouteTimeoutMetrics` | interface | `interface RouteTimeoutMetrics` | Route timeout metrics |
| `UpstreamTimeoutMetrics` | interface | `interface UpstreamTimeoutMetrics` | Upstream timeout metrics |
| `CircuitBreakerMetrics` | interface | `interface CircuitBreakerMetrics` | Circuit breaker metrics for |
| `UpstreamCircuitBreakerState` | interface | `interface UpstreamCircuitBreakerState` | Upstream circuit breaker state |
| `AdvancedMetricsConfig` | interface | `interface AdvancedMetricsConfig` | Advanced metrics configuration |
| `AdvancedMetrics` | class | `class AdvancedMetrics` | Advanced Metrics Collector |

### `src/core/body-parser.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `ContentType` | enum | `enum ContentType` | Supported content types |
| `ParsedBody` | interface | `interface ParsedBody` | Parsed body result |
| `BodyParserError` | class | `class BodyParserError extends Error` | Body parser error |
| `BodyParser` | class | `class BodyParser` | Stream-based body parser |

### `src/core/circuit-breaker.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `CircuitBreakerEvent` | enum | `enum CircuitBreakerEvent` | Circuit breaker events |
| `CircuitBreakerMetrics` | interface | `interface CircuitBreakerMetrics` | Circuit breaker metrics |
| `CircuitBreaker` | class | `class CircuitBreaker` | Circuit breaker implementation |

### `src/core/cleanup-manager.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `ResourceType` | enum | `enum ResourceType` | Resource types |
| `CleanupStats` | interface | `interface CleanupStats` | Cleanup statistics |
| `CleanupConfig` | interface | `interface CleanupConfig` | Cleanup configuration |
| `CleanupManager` | class | `class CleanupManager` | Cleanup Manager |

### `src/core/compression-handler.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `CompressionAlgorithm` | type | `type CompressionAlgorithm = 'gzip' \| 'br' \| 'deflate'` | Supported compression algorithms |
| `CompressionConfig` | interface | `interface CompressionConfig` | Compression configuration |
| `CompressionResult` | interface | `interface CompressionResult` | Compression result |
| `DecompressionResult` | interface | `interface DecompressionResult` | Decompression result |
| `CompressionHandler` | class | `class CompressionHandler` | Compression Handler |

### `src/core/concurrency-limiter.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `ConcurrencyLimiterOptions` | interface | `interface ConcurrencyLimiterOptions` | Interface export for ConcurrencyLimiterOptions. |
| `ConcurrencyLimiter` | class | `class ConcurrencyLimiter` | Class export for ConcurrencyLimiter. |

### `src/core/context.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `RequestTimestamps` | interface | `interface RequestTimestamps` | Performance tracking timestamps for request lifecycle |
| `PoolableRequestContext` | class | `class PoolableRequestContext implements RequestContext` | Enhanced request context with pooling support |
| `PoolMetrics` | interface | `interface PoolMetrics` | Pool metrics for monitoring |
| `ContextPool` | class | `class ContextPool` | Context pool for zero-allocation request handling |

### `src/core/error-response.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `ErrorResponse` | interface | `interface ErrorResponse` | Standardized error response format |
| `ErrorResponseConfig` | interface | `interface ErrorResponseConfig` | Error response configuration |
| `ErrorResponseBuilder` | class | `class ErrorResponseBuilder` | Error Response Builder |
| `errorResponseBuilder` | const | `const errorResponseBuilder = new ErrorResponseBuilder()` | Global error response builder instance |

### `src/core/errors.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `ErrorContext` | interface | `interface ErrorContext` | Error context information |
| `GatewayError` | class | `class GatewayError extends Error` | Base gateway error class |
| `UpstreamError` | class | `class UpstreamError extends GatewayError` | Upstream-related error |
| `TimeoutError` | class | `class TimeoutError extends GatewayError` | Timeout-specific error |
| `ValidationError` | class | `class ValidationError extends GatewayError` | Validation error (request/config validation) |
| `PluginError` | class | `class PluginError extends GatewayError` | Plugin execution error |
| `CircuitBreakerError` | class | `class CircuitBreakerError extends GatewayError` | Circuit breaker error (circuit open) |
| `ConnectionError` | class | `class ConnectionError extends GatewayError` | Connection pool error |
| `isRetryable` | function | `function isRetryable(error: Error \| GatewayError): boolean` | Helper to check if error is retryable |
| `getStatusCode` | function | `function getStatusCode(error: Error \| GatewayError): number` | Helper to determine HTTP status code from error |
| `wrapError` | function | `function wrapError(` | Helper to wrap standard errors in GatewayError |

### `src/core/fallback-handler.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `FallbackResponse` | interface | `interface FallbackResponse` | Fallback response |
| `FallbackConfig` | interface | `interface FallbackConfig` | Fallback configuration |
| `FallbackContext` | interface | `interface FallbackContext` | Fallback context |
| `FallbackHandler` | class | `class FallbackHandler` | Fallback Handler |

### `src/core/health-checker.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `HealthCheckResult` | interface | `interface HealthCheckResult` | Health check result |
| `HealthCheckStats` | interface | `interface HealthCheckStats` | Health check statistics |
| `HealthChecker` | class | `class HealthChecker` | Health checker implementation |

### `src/core/http-client-pool.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `PoolMetrics` | interface | `interface PoolMetrics` | Connection pool metrics |
| `HttpClientPool` | class | `class HttpClientPool` | HTTP client connection pool |

### `src/core/load-balancer.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `LoadBalancerMetrics` | interface | `interface LoadBalancerMetrics` | Load balancer metrics |
| `LoadBalancerContext` | interface | `interface LoadBalancerContext` | Load balancer context for a request |
| `LoadBalancer` | class | `class LoadBalancer` | Load balancer implementation |

### `src/core/memory-optimizer.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `MemoryStats` | interface | `interface MemoryStats` | Memory statistics |
| `HeapGrowthAnalysis` | interface | `interface HeapGrowthAnalysis` | Heap growth analysis result |
| `LeakReport` | interface | `interface LeakReport` | Memory leak report |
| `GCStats` | interface | `interface GCStats` | GC statistics |
| `MemoryOptimizer` | class | `class MemoryOptimizer` | Memory optimizer class |

### `src/core/metrics-aggregator.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `MetricsSnapshot` | interface | `interface MetricsSnapshot` | Metrics snapshot |
| `MetricsAggregator` | class | `class MetricsAggregator` | Metrics Aggregator |

### `src/core/openapi-generator.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `OpenApiInfo` | interface | `interface OpenApiInfo` | Interface export for OpenApiInfo. |
| `OpenApiDoc` | interface | `interface OpenApiDoc` | Interface export for OpenApiDoc. |
| `toOpenApiPath` | function | `function toOpenApiPath(path: string): { path: string; params: string[] }` | Convert gateway path syntax (`/users/:id`, `/files/*`) to OpenAPI (`/users/{id}`, `/files/{wildcard}`). |
| `generateOpenApi` | function | `function generateOpenApi(config: GatewayConfig, info: OpenApiInfo): OpenApiDoc` | Build an OpenAPI 3.1 document from the gateway config. Routes are grouped by their first path segment as tags. |

### `src/core/proxy-handler.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `ProxyHandlerConfig` | interface | `interface ProxyHandlerConfig` | Proxy handler configuration |
| `ProxyHandler` | class | `class ProxyHandler` | Proxy handler for upstream requests |

### `src/core/rate-limiter.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `TokenBucketConfig` | interface | `interface TokenBucketConfig` | Token bucket configuration |
| `RateLimitResult` | interface | `interface RateLimitResult` | Rate limit result |
| `TokenBucketRateLimiter` | class | `class TokenBucketRateLimiter` | Token Bucket Rate Limiter Implements high-performance token bucket algorithm with LRU eviction |
| `SlidingWindowConfig` | interface | `interface SlidingWindowConfig` | Sliding Window Counter Configuration |
| `SlidingWindowRateLimiter` | class | `class SlidingWindowRateLimiter` | Sliding Window Counter Rate Limiter Alternative algorithm for rate limiting |

### `src/core/request-transformer.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `HeaderTransformations` | interface | `interface HeaderTransformations` | Header transformation operations |
| `QueryTransformations` | interface | `interface QueryTransformations` | Query parameter transformation operations |
| `PathRewriteRule` | interface | `interface PathRewriteRule` | Path rewrite rule |
| `BodyTransformations` | interface | `interface BodyTransformations` | Body transformation operations |
| `TransformationCondition` | interface | `interface TransformationCondition` | Conditional transformation rule |
| `RequestTransformation` | interface | `interface RequestTransformation` | Complete request transformation configuration |
| `TransformationResult` | interface | `interface TransformationResult` | Transformation result |
| `RequestTransformer` | class | `class RequestTransformer` | Request Transformer |

### `src/core/response-cache-policy.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `ResponseCachePolicy` | class | `class ResponseCachePolicy implements GatewayPolicy` | Class export for ResponseCachePolicy. |

### `src/core/response-cache.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `CacheConfig` | interface | `interface CacheConfig` | Cache configuration |
| `CacheLookupState` | type | `type CacheLookupState = 'fresh' \| 'stale' \| 'miss'` | Result of a cache lookup: the stored response (if any) plus freshness state. - 'fresh'  : age <= ttl, serve directly - ' |
| `CacheLookup` | interface | `interface CacheLookup` | Interface export for CacheLookup. |
| `CachedResponse` | interface | `interface CachedResponse` | Cached response entry |
| `CacheStats` | interface | `interface CacheStats` | Cache statistics |
| `CacheControl` | interface | `interface CacheControl` | Cache control directives parsed from headers |
| `ResponseCache` | class | `class ResponseCache` | Response Cache System Implements LRU cache with TTL and HTTP caching semantics |

### `src/core/response-transformer.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `ResponseHeaderTransformations` | interface | `interface ResponseHeaderTransformations` | Response header transformation operations |
| `StatusCodeMapping` | interface | `interface StatusCodeMapping` | Status code mapping |
| `CorsConfig` | interface | `interface CorsConfig` | CORS configuration |
| `ErrorTemplate` | interface | `interface ErrorTemplate` | Error response template |
| `ResponseBodyTransformations` | interface | `interface ResponseBodyTransformations` | Response body transformations |
| `ResponseTransformationCondition` | interface | `interface ResponseTransformationCondition` | Conditional transformation rule |
| `ResponseTransformation` | interface | `interface ResponseTransformation` | Complete response transformation configuration |
| `ResponseTransformationResult` | interface | `interface ResponseTransformationResult` | Transformation result |
| `ResponseTransformer` | class | `class ResponseTransformer` | Response Transformer |

### `src/core/retry-manager.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `RetryConfig` | interface | `interface RetryConfig` | Retry configuration |
| `RetryAttempt` | interface | `interface RetryAttempt` | Retry attempt information |
| `RetryContext` | interface | `interface RetryContext` | Retry context |
| `RetryResult` | interface | `interface RetryResult<T>` | Retry result |
| `RetryManager` | class | `class RetryManager` | Retry Manager |

### `src/core/router.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `Router` | class | `class Router` | High-performance router implementation |

### `src/core/server.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `Server` | class | `class Server` | Native HTTP server implementation |

### `src/core/timeout-manager.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `TimeoutConfig` | interface | `interface TimeoutConfig` | Timeout configuration |
| `TimeoutHandle` | interface | `interface TimeoutHandle` | Timeout handle |
| `TimeoutContext` | interface | `interface TimeoutContext` | Timeout context |
| `TimeoutManager` | class | `class TimeoutManager` | Timeout Manager |

### `src/core/url-forward.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `ForwardRequest` | interface | `interface ForwardRequest` | Interface export for ForwardRequest. |
| `ForwardResult` | interface | `interface ForwardResult` | Interface export for ForwardResult. |
| `UrlForwarder` | class | `class UrlForwarder` | Class export for UrlForwarder. |

### `src/core/v8-optimizations.ts`

| Simbol | Jenis | Tanda Tangan | Tujuan |
| --- | --- | --- | --- |
| `OptimizationStatus` | interface | `interface OptimizationStatus` | Optimization status for a function |
| `ShapeAnalysis` | interface | `interface ShapeAnalysis` | Shape/hidden class analysis result |
| `DeoptInfo` | interface | `interface DeoptInfo` | Deoptimization information |
| `HandlerConfig` | interface | `interface HandlerConfig` | Handler configuration for monomorphic patterns |
| `Handler` | interface | `interface Handler<T>` | Generic handler interface |
| `V8Optimizer` | class | `class V8Optimizer` | V8 optimizer class for performance analysis |
| `createMonomorphicHandler` | function | `function createMonomorphicHandler<T>(config: HandlerConfig): Handler<T>` | Create a monomorphic handler for consistent type handling Helps V8 optimize inline caching by maintaining type consisten |
| `ensureHiddenClassStability` | function | `function ensureHiddenClassStability(obj: object): void` | Ensure hidden class stability by setting properties in consistent order Important for V8 inline caching optimization |
| `createStableObject` | function | `function createStableObject<T extends Record<string, unknown>>(` | Create object with stable shape Initializes all properties at once to create stable hidden class |
| `createPropertyAccessor` | function | `function createPropertyAccessor<T extends object, K extends keyof T>(` | Fast property accessor using IC-friendly patterns Uses monomorphic property access for better optimization |
| `PolymorphismDetector` | class | `class PolymorphismDetector` | Polymorphism detector Helps identify code paths that might deoptimize |
| `polymorphismDetector` | const | `const polymorphismDetector = new PolymorphismDetector()` | Export singleton detector instance |

## Catatan (Notes)

### RadixRouter
Router mengompilasi pola rute ke dalam trie radix terkompresi dengan kompleksitas pencarian O(k) di mana k adalah kedalaman path.

### ProxyHandler
Mengalirkan request klien langsung ke soket upstream menggunakan connection pool Keep-Alive untuk memangkas latensi handshake.

### ResponseCache
Menyediakan cache in-memory berkecepatan tinggi dengan pembatalan TTL atomik dan pembatasan batas memori.

## Sumber (Source)

- `src/core/advanced-metrics.ts`
- `src/core/body-parser.ts`
- `src/core/circuit-breaker.ts`
- `src/core/cleanup-manager.ts`
- `src/core/compression-handler.ts`
- `src/core/concurrency-limiter.ts`
- `src/core/context.ts`
- `src/core/error-response.ts`
- `src/core/errors.ts`
- `src/core/fallback-handler.ts`
- `src/core/health-checker.ts`
- `src/core/http-client-pool.ts`
- `src/core/load-balancer.ts`
- `src/core/memory-optimizer.ts`
- `src/core/metrics-aggregator.ts`
- `src/core/openapi-generator.ts`
- `src/core/proxy-handler.ts`
- `src/core/rate-limiter.ts`
- `src/core/request-transformer.ts`
- `src/core/response-cache-policy.ts`
- `src/core/response-cache.ts`
- `src/core/response-transformer.ts`
- `src/core/retry-manager.ts`
- `src/core/router.ts`
- `src/core/server.ts`
- `src/core/timeout-manager.ts`
- `src/core/url-forward.ts`
- `src/core/v8-optimizations.ts`

## Lihat juga (See also)

- [Pendalaman: Perutean Inti & Proksi](/id/docs/deep-dive/core-routing/)
- [Pendalaman: Arsitektur](/id/docs/deep-dive/architecture/)
