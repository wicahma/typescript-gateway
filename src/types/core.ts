/**
 * Core type definitions for the ultra-high-performance API gateway
 * All types are designed for zero-copy and minimal allocations
 */

import { IncomingMessage, ServerResponse } from 'http';

/**
 * HTTP methods supported by the gateway
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

/**
 * Pooled request context object
 * This object is reused across requests to minimize allocations
 * Phase 2: Enhanced with route matching and performance timestamps
 */
export interface RequestContext {
  /** Request ID for tracing */
  requestId: string;
  /** Start timestamp in nanoseconds */
  startTime: bigint;
  /** HTTP method */
  method: HttpMethod;
  /** Request path */
  path: string;
  /** Query parameters (lazy parsed) */
  query: Record<string, string> | null;
  /** Route parameters (extracted from path) */
  params: Record<string, string>;
  /** Request headers (direct reference, no copy) */
  headers: Record<string, string | string[] | undefined>;
  /** Request body buffer (for POST/PUT/PATCH) */
  body: Buffer | null;
  /** Original Node.js request object */
  req: IncomingMessage;
  /** Original Node.js response object */
  res: ServerResponse;
  /** Upstream target for proxying */
  upstream: UpstreamTarget | null;
  /** Custom context data for plugins */
  state: Record<string, unknown>;
  /** Whether the response has been sent */
  responded: boolean;

  // Phase 2: Enhanced fields
  /** Matched route information */
  route: RouteMatch | null;
  /** Performance tracking timestamps */
  timestamps: {
    routeMatch?: number;
    pluginStart?: number;
    pluginEnd?: number;
    upstreamStart?: number;
    upstreamEnd?: number;
  };
}

/**
 * Route match result (Phase 2)
 */
export interface RouteMatch {
  handler: RouteHandler;
  params: Record<string, string>;
  route: Route;
}

/**
 * Route handler function signature
 * Handlers should be monomorphic for V8 optimization
 */
export type RouteHandler = (ctx: RequestContext) => Promise<void> | void;

/**
 * Route definition
 */
export interface Route {
  /** HTTP method */
  method: HttpMethod;
  /** Path pattern (supports :param and *wildcard) */
  path: string;
  /** Route handler */
  handler: RouteHandler;
  /** Priority for route matching (higher = checked first) */
  priority: number;
  /** Compiled regex for dynamic routes (cached) */
  pattern?: RegExp;
  /** Parameter names for dynamic routes */
  paramNames?: string[];
}

/**
 * Upstream service target definition
 */
export interface UpstreamTarget {
  /** Unique identifier */
  id: string;
  /** Protocol (http or https) */
  protocol: 'http' | 'https';
  /** Hostname or IP address */
  host: string;
  /** Port number */
  port: number;
  /** Base path prefix */
  basePath: string;
  /** Connection pool size */
  poolSize: number;
  /** Request timeout in milliseconds */
  timeout: number;
  /** Health check configuration */
  healthCheck: HealthCheckConfig;
  /** Current health status */
  healthy: boolean;
  /** Circuit breaker state */
  circuitBreaker: CircuitBreakerState;
  /** Connection pool configuration (Phase 4) */
  connectionPool?: ConnectionPoolConfig;
  /** Weight for weighted round robin (Phase 4) */
  weight?: number;
  /** Active connections count (Phase 4) */
  activeConnections?: number;
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  /** Enable health checks */
  enabled: boolean;
  /** Health check interval in milliseconds */
  interval: number;
  /** Health check timeout in milliseconds */
  timeout: number;
  /** Health check path */
  path: string;
  /** Expected status code */
  expectedStatus: number;
  /** Health check type (Phase 4) */
  type?: HealthCheckType;
  /** Grace period before marking unhealthy in milliseconds (Phase 4) */
  gracePeriod?: number;
  /** Number of consecutive failures before unhealthy (Phase 4) */
  unhealthyThreshold?: number;
  /** Number of consecutive successes before healthy (Phase 4) */
  healthyThreshold?: number;
}

/**
 * Load balancing strategies
 */
export type LoadBalancerStrategy =
  | 'round-robin'
  | 'least-connections'
  | 'random'
  | 'weighted-round-robin'
  | 'ip-hash';

/**
 * Circuit breaker states
 */
export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Failure threshold to open circuit */
  failureThreshold: number;
  /** Success threshold to close circuit from half-open */
  successThreshold: number;
  /** Timeout before attempting half-open in milliseconds */
  timeout: number;
  /** Rolling window size for failure counting */
  windowSize: number;
}

/**
 * Worker message types for master-worker communication
 */
export enum WorkerMessageType {
  INIT = 'INIT',
  CONFIG_UPDATE = 'CONFIG_UPDATE',
  SHUTDOWN = 'SHUTDOWN',
  METRICS_REQUEST = 'METRICS_REQUEST',
  METRICS_RESPONSE = 'METRICS_RESPONSE',
  HEALTH_CHECK = 'HEALTH_CHECK',
}

/**
 * Worker message protocol
 */
export interface WorkerMessage {
  /** Message type */
  type: WorkerMessageType;
  /** Message payload */
  payload: unknown;
  /** Timestamp */
  timestamp: number;
}

/**
 * Performance metrics snapshot
 * Designed for lock-free atomic operations
 */
export interface MetricsSnapshot {
  /** Total requests processed */
  totalRequests: number;
  /** Total errors */
  totalErrors: number;
  /** Requests per second */
  requestsPerSecond: number;
  /** Average latency in milliseconds */
  avgLatency: number;
  /** P50 latency in milliseconds */
  p50Latency: number;
  /** P95 latency in milliseconds */
  p95Latency: number;
  /** P99 latency in milliseconds */
  p99Latency: number;
  /** Active connections */
  activeConnections: number;
  /** Memory usage in bytes */
  memoryUsage: NodeJS.MemoryUsage;
  /** CPU usage percentage */
  cpuUsage: NodeJS.CpuUsage;
  /** Timestamp of snapshot */
  timestamp: number;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  /** Server port */
  port: number;
  /** Server host */
  host: string;
  /** Enable keep-alive connections */
  keepAlive: boolean;
  /** Keep-alive timeout in milliseconds */
  keepAliveTimeout: number;
  /** Request timeout in milliseconds */
  requestTimeout: number;
  /** Max header size in bytes */
  maxHeaderSize: number;
  /** Max request body size in bytes */
  maxBodySize: number;
}

/**
 * Gateway configuration (root)
 */
export interface GatewayConfig {
  /** Server settings */
  server: ServerConfig;
  /** Route definitions */
  routes: Route[];
  /** Upstream configurations */
  upstreams: UpstreamTarget[];
  /** Plugin configurations */
  plugins: PluginConfig[];
  /** Performance tuning */
  performance: PerformanceConfig;
  /** Body parser configuration (Phase 4) */
  bodyParser?: BodyParserConfig;
  /** Load balancer configuration (Phase 4) */
  loadBalancer?: LoadBalancerConfig;
  /** Circuit breaker configuration (Phase 4) */
  circuitBreaker?: CircuitBreakerConfig;
}

/**
 * Plugin configuration
 */
export interface PluginConfig {
  /** Plugin name */
  name: string;
  /** Enable/disable plugin */
  enabled: boolean;
  /** Plugin-specific settings */
  settings: Record<string, unknown>;
}

/**
 * Performance tuning configuration
 */
export interface PerformanceConfig {
  /** Number of worker threads (0 = CPU count) */
  workerCount: number;
  /** Request context pool size */
  contextPoolSize: number;
  /** Buffer pool size */
  bufferPoolSize: number;
  /** Response pool size */
  responsePoolSize: number;
  /** Enable object pooling */
  enablePooling: boolean;
}

/**
 * Body parser configuration (Phase 4)
 */
export interface BodyParserConfig {
  /** Enable body parsing */
  enabled: boolean;
  /** Size limits per content type in bytes */
  limits: {
    json: number;
    urlencoded: number;
    multipart: number;
    text: number;
  };
  /** Parser timeout in milliseconds */
  timeout: number;
  /** Enable parser pooling */
  enablePooling: boolean;
}

/**
 * Connection pool configuration (Phase 4)
 */
export interface ConnectionPoolConfig {
  /** Minimum pool size */
  minSize: number;
  /** Maximum pool size */
  maxSize: number;
  /** Idle timeout in milliseconds */
  idleTimeout: number;
  /** Connection timeout in milliseconds */
  connectionTimeout: number;
  /** Request timeout in milliseconds */
  requestTimeout: number;
  /** Enable HTTP/2 */
  http2: boolean;
}

/**
 * Health check type (Phase 4)
 */
export type HealthCheckType = 'active' | 'passive' | 'hybrid';

/**
 * Health status (Phase 4)
 */
export enum HealthStatus {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  UNHEALTHY = 'UNHEALTHY',
}

/**
 * Load balancer configuration (Phase 4)
 */
export interface LoadBalancerConfig {
  /** Load balancing strategy */
  strategy: LoadBalancerStrategy;
  /** Health check type */
  healthCheckType: HealthCheckType;
  /** Enable health-aware routing */
  healthAware: boolean;
}
