/**
 * Advanced Metrics Collector - Enhanced metrics for Phase 6
 * Phase 6: Proxy Logic & Request Forwarding
 * 
 * Features:
 * - Request/response size tracking
 * - Transformation metrics
 * - Compression metrics
 * - WebSocket metrics
 * - Per-route detailed metrics
 * - Per-upstream metrics
 * - Error categorization
 * - Lock-free collection
 */

import { logger } from '../utils/logger.js';

/**
 * Transformation metrics
 */
export interface TransformationMetrics {
  /** Total transformations */
  count: number;
  /** Total duration in ms */
  totalDuration: number;
  /** Average duration in ms */
  avgDuration: number;
  /** Min duration in ms */
  minDuration: number;
  /** Max duration in ms */
  maxDuration: number;
}

/**
 * Compression metrics
 */
export interface CompressionMetrics {
  /** Total compressions */
  count: number;
  /** Total original size in bytes */
  totalOriginalSize: number;
  /** Total compressed size in bytes */
  totalCompressedSize: number;
  /** Average compression ratio */
  avgRatio: number;
  /** Total compression duration in ms */
  totalDuration: number;
  /** Average compression duration in ms */
  avgDuration: number;
}

/**
 * WebSocket metrics
 */
export interface WebSocketMetrics {
  /** Active connections */
  activeConnections: number;
  /** Total connections */
  totalConnections: number;
  /** Total bytes sent */
  totalBytesSent: number;
  /** Total bytes received */
  totalBytesReceived: number;
  /** Total messages sent */
  totalMessagesSent: number;
  /** Total messages received */
  totalMessagesReceived: number;
  /** Average connection duration in ms */
  avgConnectionDuration: number;
}

/**
 * Per-route metrics
 */
export interface RouteMetrics {
  /** Route pattern */
  route: string;
  /** Request count */
  requestCount: number;
  /** Total request size in bytes */
  totalRequestSize: number;
  /** Total response size in bytes */
  totalResponseSize: number;
  /** Average request size in bytes */
  avgRequestSize: number;
  /** Average response size in bytes */
  avgResponseSize: number;
  /** Total latency in ms */
  totalLatency: number;
  /** Average latency in ms */
  avgLatency: number;
  /** Error count */
  errorCount: number;
  /** Status code distribution */
  statusCodes: Map<number, number>;
}

/**
 * Per-upstream metrics
 */
export interface UpstreamMetrics {
  /** Upstream ID */
  upstreamId: string;
  /** Request count */
  requestCount: number;
  /** Total latency in ms */
  totalLatency: number;
  /** Average latency in ms */
  avgLatency: number;
  /** Error count */
  errorCount: number;
  /** Success count */
  successCount: number;
  /** Total bytes sent */
  totalBytesSent: number;
  /** Total bytes received */
  totalBytesReceived: number;
}

/**
 * Error metrics by category
 */
export interface ErrorMetrics {
  /** Client errors (4xx) */
  clientErrors: number;
  /** Server errors (5xx) */
  serverErrors: number;
  /** Network errors */
  networkErrors: number;
  /** Timeout errors */
  timeoutErrors: number;
  /** Circuit breaker errors */
  circuitBreakerErrors: number;
  /** Transformation errors */
  transformationErrors: number;
  /** Other errors */
  otherErrors: number;
}

/**
 * Advanced metrics configuration
 */
export interface AdvancedMetricsConfig {
  /** Enable metrics collection */
  enabled: boolean;
  /** Collect per-route metrics */
  collectPerRoute: boolean;
  /** Collect per-upstream metrics */
  collectPerUpstream: boolean;
  /** Collect transformation metrics */
  collectTransformations: boolean;
  /** Collect compression metrics */
  collectCompression: boolean;
  /** Collect WebSocket metrics */
  collectWebSocket: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: AdvancedMetricsConfig = {
  enabled: true,
  collectPerRoute: true,
  collectPerUpstream: true,
  collectTransformations: true,
  collectCompression: true,
  collectWebSocket: true,
};

/**
 * Advanced Metrics Collector
 */
export class AdvancedMetrics {
  private config: AdvancedMetricsConfig;
  
  // Transformation metrics
  private requestTransformations: TransformationMetrics = this.createTransformationMetrics();
  private responseTransformations: TransformationMetrics = this.createTransformationMetrics();

  // Compression metrics
  private compressionMetrics: CompressionMetrics = this.createCompressionMetrics();
  private decompressionMetrics: CompressionMetrics = this.createCompressionMetrics();

  // WebSocket metrics
  private wsMetrics: WebSocketMetrics = this.createWebSocketMetrics();

  // Per-route metrics
  private routeMetrics: Map<string, RouteMetrics> = new Map();

  // Per-upstream metrics
  private upstreamMetrics: Map<string, UpstreamMetrics> = new Map();

  // Error metrics
  private errorMetrics: ErrorMetrics = this.createErrorMetrics();

  constructor(config?: Partial<AdvancedMetricsConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AdvancedMetricsConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Record request transformation
   */
  recordRequestTransformation(duration: number): void {
    if (!this.config.enabled || !this.config.collectTransformations) return;

    this.updateTransformationMetrics(this.requestTransformations, duration);
  }

  /**
   * Record response transformation
   */
  recordResponseTransformation(duration: number): void {
    if (!this.config.enabled || !this.config.collectTransformations) return;

    this.updateTransformationMetrics(this.responseTransformations, duration);
  }

  /**
   * Record compression
   */
  recordCompression(
    originalSize: number,
    compressedSize: number,
    duration: number
  ): void {
    if (!this.config.enabled || !this.config.collectCompression) return;

    const ratio = compressedSize / originalSize;
    this.updateCompressionMetrics(
      this.compressionMetrics,
      originalSize,
      compressedSize,
      ratio,
      duration
    );
  }

  /**
   * Record decompression
   */
  recordDecompression(
    originalSize: number,
    decompressedSize: number,
    duration: number
  ): void {
    if (!this.config.enabled || !this.config.collectCompression) return;

    const ratio = originalSize / decompressedSize;
    this.updateCompressionMetrics(
      this.decompressionMetrics,
      decompressedSize,
      originalSize,
      ratio,
      duration
    );
  }

  /**
   * Record WebSocket connection
   */
  recordWebSocketConnection(active: boolean): void {
    if (!this.config.enabled || !this.config.collectWebSocket) return;

    if (active) {
      this.wsMetrics.activeConnections++;
      this.wsMetrics.totalConnections++;
    } else {
      this.wsMetrics.activeConnections = Math.max(0, this.wsMetrics.activeConnections - 1);
    }
  }

  /**
   * Record WebSocket data transfer
   */
  recordWebSocketTransfer(
    bytesSent: number,
    bytesReceived: number,
    messagesSent: number,
    messagesReceived: number
  ): void {
    if (!this.config.enabled || !this.config.collectWebSocket) return;

    this.wsMetrics.totalBytesSent += bytesSent;
    this.wsMetrics.totalBytesReceived += bytesReceived;
    this.wsMetrics.totalMessagesSent += messagesSent;
    this.wsMetrics.totalMessagesReceived += messagesReceived;
  }

  /**
   * Record WebSocket connection duration
   */
  recordWebSocketDuration(duration: number): void {
    if (!this.config.enabled || !this.config.collectWebSocket) return;

    const total = this.wsMetrics.avgConnectionDuration * (this.wsMetrics.totalConnections - 1);
    this.wsMetrics.avgConnectionDuration =
      (total + duration) / this.wsMetrics.totalConnections;
  }

  /**
   * Record route metrics
   */
  recordRouteMetrics(
    route: string,
    requestSize: number,
    responseSize: number,
    latency: number,
    statusCode: number,
    error: boolean
  ): void {
    if (!this.config.enabled || !this.config.collectPerRoute) return;

    let metrics = this.routeMetrics.get(route);
    if (!metrics) {
      metrics = {
        route,
        requestCount: 0,
        totalRequestSize: 0,
        totalResponseSize: 0,
        avgRequestSize: 0,
        avgResponseSize: 0,
        totalLatency: 0,
        avgLatency: 0,
        errorCount: 0,
        statusCodes: new Map(),
      };
      this.routeMetrics.set(route, metrics);
    }

    metrics.requestCount++;
    metrics.totalRequestSize += requestSize;
    metrics.totalResponseSize += responseSize;
    metrics.totalLatency += latency;
    
    metrics.avgRequestSize = metrics.totalRequestSize / metrics.requestCount;
    metrics.avgResponseSize = metrics.totalResponseSize / metrics.requestCount;
    metrics.avgLatency = metrics.totalLatency / metrics.requestCount;

    if (error) {
      metrics.errorCount++;
    }

    // Update status code distribution
    const count = metrics.statusCodes.get(statusCode) || 0;
    metrics.statusCodes.set(statusCode, count + 1);
  }

  /**
   * Record upstream metrics
   */
  recordUpstreamMetrics(
    upstreamId: string,
    latency: number,
    bytesSent: number,
    bytesReceived: number,
    error: boolean
  ): void {
    if (!this.config.enabled || !this.config.collectPerUpstream) return;

    let metrics = this.upstreamMetrics.get(upstreamId);
    if (!metrics) {
      metrics = {
        upstreamId,
        requestCount: 0,
        totalLatency: 0,
        avgLatency: 0,
        errorCount: 0,
        successCount: 0,
        totalBytesSent: 0,
        totalBytesReceived: 0,
      };
      this.upstreamMetrics.set(upstreamId, metrics);
    }

    metrics.requestCount++;
    metrics.totalLatency += latency;
    metrics.avgLatency = metrics.totalLatency / metrics.requestCount;
    metrics.totalBytesSent += bytesSent;
    metrics.totalBytesReceived += bytesReceived;

    if (error) {
      metrics.errorCount++;
    } else {
      metrics.successCount++;
    }
  }

  /**
   * Record error by category
   */
  recordError(category: keyof ErrorMetrics): void {
    if (!this.config.enabled) return;

    this.errorMetrics[category]++;
  }

  /**
   * Categorize error by status code or type
   */
  categorizeError(statusCode?: number, errorType?: string): keyof ErrorMetrics {
    if (statusCode) {
      if (statusCode >= 400 && statusCode < 500) {
        return 'clientErrors';
      } else if (statusCode >= 500) {
        return 'serverErrors';
      }
    }

    if (errorType) {
      if (errorType.includes('timeout')) {
        return 'timeoutErrors';
      } else if (errorType.includes('network') || errorType.includes('ECONNREFUSED')) {
        return 'networkErrors';
      } else if (errorType.includes('circuit') || errorType.includes('breaker')) {
        return 'circuitBreakerErrors';
      } else if (errorType.includes('transform')) {
        return 'transformationErrors';
      }
    }

    return 'otherErrors';
  }

  /**
   * Get all metrics
   */
  getMetrics(): {
    requestTransformations: TransformationMetrics;
    responseTransformations: TransformationMetrics;
    compression: CompressionMetrics;
    decompression: CompressionMetrics;
    webSocket: WebSocketMetrics;
    routes: RouteMetrics[];
    upstreams: UpstreamMetrics[];
    errors: ErrorMetrics;
  } {
    return {
      requestTransformations: { ...this.requestTransformations },
      responseTransformations: { ...this.responseTransformations },
      compression: { ...this.compressionMetrics },
      decompression: { ...this.decompressionMetrics },
      webSocket: { ...this.wsMetrics },
      routes: Array.from(this.routeMetrics.values()),
      upstreams: Array.from(this.upstreamMetrics.values()),
      errors: { ...this.errorMetrics },
    };
  }

  /**
   * Get route metrics
   */
  getRouteMetrics(route?: string): RouteMetrics[] {
    if (route) {
      const metrics = this.routeMetrics.get(route);
      return metrics ? [metrics] : [];
    }
    return Array.from(this.routeMetrics.values());
  }

  /**
   * Get upstream metrics
   */
  getUpstreamMetrics(upstreamId?: string): UpstreamMetrics[] {
    if (upstreamId) {
      const metrics = this.upstreamMetrics.get(upstreamId);
      return metrics ? [metrics] : [];
    }
    return Array.from(this.upstreamMetrics.values());
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.requestTransformations = this.createTransformationMetrics();
    this.responseTransformations = this.createTransformationMetrics();
    this.compressionMetrics = this.createCompressionMetrics();
    this.decompressionMetrics = this.createCompressionMetrics();
    this.wsMetrics = this.createWebSocketMetrics();
    this.routeMetrics.clear();
    this.upstreamMetrics.clear();
    this.errorMetrics = this.createErrorMetrics();

    logger.info('Advanced metrics reset');
  }

  /**
   * Update transformation metrics
   */
  private updateTransformationMetrics(metrics: TransformationMetrics, duration: number): void {
    metrics.count++;
    metrics.totalDuration += duration;
    metrics.avgDuration = metrics.totalDuration / metrics.count;
    metrics.minDuration = Math.min(metrics.minDuration, duration);
    metrics.maxDuration = Math.max(metrics.maxDuration, duration);
  }

  /**
   * Update compression metrics
   */
  private updateCompressionMetrics(
    metrics: CompressionMetrics,
    originalSize: number,
    compressedSize: number,
    _ratio: number,
    duration: number
  ): void {
    metrics.count++;
    metrics.totalOriginalSize += originalSize;
    metrics.totalCompressedSize += compressedSize;
    metrics.avgRatio = metrics.totalCompressedSize / metrics.totalOriginalSize;
    metrics.totalDuration += duration;
    metrics.avgDuration = metrics.totalDuration / metrics.count;
  }

  /**
   * Create transformation metrics object
   */
  private createTransformationMetrics(): TransformationMetrics {
    return {
      count: 0,
      totalDuration: 0,
      avgDuration: 0,
      minDuration: Infinity,
      maxDuration: 0,
    };
  }

  /**
   * Create compression metrics object
   */
  private createCompressionMetrics(): CompressionMetrics {
    return {
      count: 0,
      totalOriginalSize: 0,
      totalCompressedSize: 0,
      avgRatio: 0,
      totalDuration: 0,
      avgDuration: 0,
    };
  }

  /**
   * Create WebSocket metrics object
   */
  private createWebSocketMetrics(): WebSocketMetrics {
    return {
      activeConnections: 0,
      totalConnections: 0,
      totalBytesSent: 0,
      totalBytesReceived: 0,
      totalMessagesSent: 0,
      totalMessagesReceived: 0,
      avgConnectionDuration: 0,
    };
  }

  /**
   * Create error metrics object
   */
  private createErrorMetrics(): ErrorMetrics {
    return {
      clientErrors: 0,
      serverErrors: 0,
      networkErrors: 0,
      timeoutErrors: 0,
      circuitBreakerErrors: 0,
      transformationErrors: 0,
      otherErrors: 0,
    };
  }
}
