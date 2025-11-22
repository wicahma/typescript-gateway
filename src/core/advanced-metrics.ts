/**
 * Advanced Metrics Collector - Enhanced metrics for Phase 6 & Phase 8
 * Phase 6: Proxy Logic & Request Forwarding
 * Phase 8: Monitoring & Observability
 * 
 * Features:
 * - Request/response size tracking
 * - Transformation metrics
 * - Compression metrics
 * - WebSocket metrics
 * - Per-route detailed metrics
 * - Per-upstream metrics
 * - Error categorization
 * - Error rate tracking (Phase 8)
 * - Retry statistics (Phase 8)
 * - Timeout frequency tracking (Phase 8)
 * - Circuit breaker metrics (Phase 8)
 * - Lock-free collection
 */

import { logger } from '../utils/logger.js';
import { CircuitBreakerState } from '../types/core.js';

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
 * Error rate metrics for Phase 8
 */
export interface ErrorRateMetrics {
  /** Error counts by type over time windows */
  windows: {
    /** 1 minute window */
    oneMinute: TimeWindowMetrics;
    /** 5 minute window */
    fiveMinute: TimeWindowMetrics;
    /** 15 minute window */
    fifteenMinute: TimeWindowMetrics;
  };
  /** Error rate by route */
  byRoute: Map<string, RouteErrorRate>;
  /** Error rate by upstream */
  byUpstream: Map<string, UpstreamErrorRate>;
}

/**
 * Time window metrics
 */
export interface TimeWindowMetrics {
  /** Total requests in window */
  totalRequests: number;
  /** Total errors in window */
  totalErrors: number;
  /** Error rate percentage */
  errorRate: number;
  /** Errors by type */
  errorsByType: Record<keyof ErrorMetrics, number>;
  /** Window start timestamp */
  windowStart: number;
}

/**
 * Route error rate
 */
export interface RouteErrorRate {
  /** Route pattern */
  route: string;
  /** Total requests */
  totalRequests: number;
  /** Total errors */
  totalErrors: number;
  /** Error rate percentage */
  errorRate: number;
}

/**
 * Upstream error rate
 */
export interface UpstreamErrorRate {
  /** Upstream ID */
  upstreamId: string;
  /** Total requests */
  totalRequests: number;
  /** Total errors */
  totalErrors: number;
  /** Error rate percentage */
  errorRate: number;
}

/**
 * Retry statistics for Phase 8
 */
export interface RetryStatistics {
  /** Total retry attempts */
  totalAttempts: number;
  /** Successful retries */
  successfulRetries: number;
  /** Failed retries (exhausted) */
  failedRetries: number;
  /** Retry success rate percentage */
  successRate: number;
  /** Average retry count per request */
  avgRetryCount: number;
  /** Retry delays (min/max/avg in ms) */
  delays: {
    min: number;
    max: number;
    avg: number;
    total: number;
  };
  /** Retry statistics by upstream */
  byUpstream: Map<string, UpstreamRetryStats>;
}

/**
 * Upstream retry statistics
 */
export interface UpstreamRetryStats {
  /** Upstream ID */
  upstreamId: string;
  /** Total retry attempts */
  totalAttempts: number;
  /** Successful retries */
  successfulRetries: number;
  /** Failed retries */
  failedRetries: number;
  /** Success rate percentage */
  successRate: number;
}

/**
 * Timeout metrics for Phase 8
 */
export interface TimeoutMetrics {
  /** Total timeouts */
  totalTimeouts: number;
  /** Timeouts by type */
  byType: {
    connection: number;
    request: number;
    upstream: number;
    plugin: number;
  };
  /** Timeout rate by route */
  byRoute: Map<string, RouteTimeoutMetrics>;
  /** Timeout rate by upstream */
  byUpstream: Map<string, UpstreamTimeoutMetrics>;
  /** Time-to-timeout distribution (in ms) */
  distribution: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
}

/**
 * Route timeout metrics
 */
export interface RouteTimeoutMetrics {
  /** Route pattern */
  route: string;
  /** Total requests */
  totalRequests: number;
  /** Total timeouts */
  totalTimeouts: number;
  /** Timeout rate percentage */
  timeoutRate: number;
}

/**
 * Upstream timeout metrics
 */
export interface UpstreamTimeoutMetrics {
  /** Upstream ID */
  upstreamId: string;
  /** Total requests */
  totalRequests: number;
  /** Total timeouts */
  totalTimeouts: number;
  /** Timeout rate percentage */
  timeoutRate: number;
}

/**
 * Circuit breaker metrics for Phase 8
 */
export interface CircuitBreakerMetrics {
  /** State transitions */
  transitions: {
    /** CLOSED -> OPEN */
    closedToOpen: number;
    /** OPEN -> HALF_OPEN */
    openToHalfOpen: number;
    /** HALF_OPEN -> CLOSED */
    halfOpenToClosed: number;
    /** HALF_OPEN -> OPEN */
    halfOpenToOpen: number;
  };
  /** Time spent in each state (ms) */
  timeInState: {
    closed: number;
    open: number;
    halfOpen: number;
  };
  /** Requests rejected due to open circuit */
  rejectedRequests: number;
  /** Successful recovery attempts */
  successfulRecoveries: number;
  /** Per-upstream circuit breaker state */
  byUpstream: Map<string, UpstreamCircuitBreakerState>;
}

/**
 * Upstream circuit breaker state
 */
export interface UpstreamCircuitBreakerState {
  /** Upstream ID */
  upstreamId: string;
  /** Current state */
  state: CircuitBreakerState;
  /** Last state change timestamp */
  lastStateChange: number;
  /** Time in current state (ms) */
  timeInCurrentState: number;
  /** Total rejected requests */
  rejectedRequests: number;
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
  /** Collect error rate metrics (Phase 8) */
  collectErrorRates?: boolean;
  /** Collect retry statistics (Phase 8) */
  collectRetryStats?: boolean;
  /** Collect timeout metrics (Phase 8) */
  collectTimeouts?: boolean;
  /** Collect circuit breaker metrics (Phase 8) */
  collectCircuitBreaker?: boolean;
  /** Time window sizes in seconds (Phase 8) */
  timeWindows?: number[];
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
  collectErrorRates: true,
  collectRetryStats: true,
  collectTimeouts: true,
  collectCircuitBreaker: true,
  timeWindows: [60, 300, 900], // 1min, 5min, 15min in seconds
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

  // Phase 8: Error rate metrics
  private errorRateMetrics: ErrorRateMetrics = this.createErrorRateMetrics();
  private errorRateHistory: Array<{ timestamp: number; errors: ErrorMetrics; total: number }> = [];

  // Phase 8: Retry statistics
  private retryStatistics: RetryStatistics = this.createRetryStatistics();

  // Phase 8: Timeout metrics
  private timeoutMetrics: TimeoutMetrics = this.createTimeoutMetrics();
  private timeoutDurations: number[] = [];

  // Phase 8: Circuit breaker metrics
  private circuitBreakerMetrics: CircuitBreakerMetrics = this.createCircuitBreakerMetrics();

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
   * Record error rate for Phase 8
   */
  recordErrorRate(
    route: string,
    upstreamId: string | undefined,
    errorType: keyof ErrorMetrics,
    success: boolean
  ): void {
    if (!this.config.enabled || !this.config.collectErrorRates) return;

    const now = Date.now();

    // Add to history
    const errorCounts = this.createErrorMetrics();
    if (!success) {
      errorCounts[errorType]++;
    }
    this.errorRateHistory.push({
      timestamp: now,
      errors: errorCounts,
      total: 1,
    });

    // Clean up old history entries
    const windowSizes = this.config.timeWindows || [60, 300, 900];
    const maxWindow = Math.max(...windowSizes) * 1000; // Convert to ms
    this.errorRateHistory = this.errorRateHistory.filter(
      (entry) => now - entry.timestamp < maxWindow
    );

    // Update time windows
    this.updateErrorRateWindows();

    // Update by-route error rates
    if (route) {
      let routeRate = this.errorRateMetrics.byRoute.get(route);
      if (!routeRate) {
        routeRate = {
          route,
          totalRequests: 0,
          totalErrors: 0,
          errorRate: 0,
        };
        this.errorRateMetrics.byRoute.set(route, routeRate);
      }
      routeRate.totalRequests++;
      if (!success) {
        routeRate.totalErrors++;
      }
      routeRate.errorRate = (routeRate.totalErrors / routeRate.totalRequests) * 100;
    }

    // Update by-upstream error rates
    if (upstreamId) {
      let upstreamRate = this.errorRateMetrics.byUpstream.get(upstreamId);
      if (!upstreamRate) {
        upstreamRate = {
          upstreamId,
          totalRequests: 0,
          totalErrors: 0,
          errorRate: 0,
        };
        this.errorRateMetrics.byUpstream.set(upstreamId, upstreamRate);
      }
      upstreamRate.totalRequests++;
      if (!success) {
        upstreamRate.totalErrors++;
      }
      upstreamRate.errorRate = (upstreamRate.totalErrors / upstreamRate.totalRequests) * 100;
    }
  }

  /**
   * Update error rate time windows
   */
  private updateErrorRateWindows(): void {
    const now = Date.now();
    const windows = this.config.timeWindows || [60, 300, 900];

    // Update each window
    for (const windowSize of windows) {
      const windowMs = windowSize * 1000;
      const windowStart = now - windowMs;
      
      const entriesInWindow = this.errorRateHistory.filter(
        (entry) => entry.timestamp >= windowStart
      );

      const totalRequests = entriesInWindow.reduce((sum, entry) => sum + entry.total, 0);
      const errorsByType = this.createErrorMetrics();
      
      for (const entry of entriesInWindow) {
        for (const key of Object.keys(entry.errors) as Array<keyof ErrorMetrics>) {
          errorsByType[key] += entry.errors[key];
        }
      }

      const totalErrors = Object.values(errorsByType).reduce((sum, count) => sum + count, 0);
      const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

      const windowMetrics: TimeWindowMetrics = {
        totalRequests,
        totalErrors,
        errorRate,
        errorsByType,
        windowStart,
      };

      // Assign to correct window
      if (windowSize === 60) {
        this.errorRateMetrics.windows.oneMinute = windowMetrics;
      } else if (windowSize === 300) {
        this.errorRateMetrics.windows.fiveMinute = windowMetrics;
      } else if (windowSize === 900) {
        this.errorRateMetrics.windows.fifteenMinute = windowMetrics;
      }
    }
  }

  /**
   * Record retry attempt for Phase 8
   */
  recordRetryAttempt(
    upstreamId: string | undefined,
    attempts: number,
    success: boolean,
    totalDelay: number
  ): void {
    if (!this.config.enabled || !this.config.collectRetryStats) return;

    this.retryStatistics.totalAttempts += attempts - 1; // Don't count initial attempt
    
    if (success) {
      this.retryStatistics.successfulRetries++;
    } else {
      this.retryStatistics.failedRetries++;
    }

    // Update success rate
    const totalRetries = this.retryStatistics.successfulRetries + this.retryStatistics.failedRetries;
    this.retryStatistics.successRate = totalRetries > 0
      ? (this.retryStatistics.successfulRetries / totalRetries) * 100
      : 0;

    // Update average retry count
    this.retryStatistics.avgRetryCount = totalRetries > 0
      ? this.retryStatistics.totalAttempts / totalRetries
      : 0;

    // Update delay statistics
    if (totalDelay > 0) {
      this.retryStatistics.delays.total += totalDelay;
      this.retryStatistics.delays.min = Math.min(
        this.retryStatistics.delays.min,
        totalDelay
      );
      this.retryStatistics.delays.max = Math.max(
        this.retryStatistics.delays.max,
        totalDelay
      );
      this.retryStatistics.delays.avg = totalRetries > 0
        ? this.retryStatistics.delays.total / totalRetries
        : 0;
    }

    // Update per-upstream statistics
    if (upstreamId) {
      let upstreamStats = this.retryStatistics.byUpstream.get(upstreamId);
      if (!upstreamStats) {
        upstreamStats = {
          upstreamId,
          totalAttempts: 0,
          successfulRetries: 0,
          failedRetries: 0,
          successRate: 0,
        };
        this.retryStatistics.byUpstream.set(upstreamId, upstreamStats);
      }

      upstreamStats.totalAttempts += attempts - 1;
      if (success) {
        upstreamStats.successfulRetries++;
      } else {
        upstreamStats.failedRetries++;
      }

      const upstreamTotalRetries = upstreamStats.successfulRetries + upstreamStats.failedRetries;
      upstreamStats.successRate = upstreamTotalRetries > 0
        ? (upstreamStats.successfulRetries / upstreamTotalRetries) * 100
        : 0;
    }
  }

  /**
   * Record timeout for Phase 8
   */
  recordTimeout(
    timeoutType: 'connection' | 'request' | 'upstream' | 'plugin',
    route: string | undefined,
    upstreamId: string | undefined,
    duration: number
  ): void {
    if (!this.config.enabled || !this.config.collectTimeouts) return;

    this.timeoutMetrics.totalTimeouts++;
    this.timeoutMetrics.byType[timeoutType]++;

    // Store duration for distribution calculation
    this.timeoutDurations.push(duration);
    
    // Keep only last 10000 durations to prevent memory growth
    if (this.timeoutDurations.length > 10000) {
      this.timeoutDurations.shift();
    }

    // Update distribution
    this.updateTimeoutDistribution();

    // Update by-route timeout metrics
    if (route) {
      let routeTimeout = this.timeoutMetrics.byRoute.get(route);
      if (!routeTimeout) {
        routeTimeout = {
          route,
          totalRequests: 0,
          totalTimeouts: 0,
          timeoutRate: 0,
        };
        this.timeoutMetrics.byRoute.set(route, routeTimeout);
      }
      routeTimeout.totalRequests++;
      routeTimeout.totalTimeouts++;
      routeTimeout.timeoutRate = (routeTimeout.totalTimeouts / routeTimeout.totalRequests) * 100;
    }

    // Update by-upstream timeout metrics
    if (upstreamId) {
      let upstreamTimeout = this.timeoutMetrics.byUpstream.get(upstreamId);
      if (!upstreamTimeout) {
        upstreamTimeout = {
          upstreamId,
          totalRequests: 0,
          totalTimeouts: 0,
          timeoutRate: 0,
        };
        this.timeoutMetrics.byUpstream.set(upstreamId, upstreamTimeout);
      }
      upstreamTimeout.totalRequests++;
      upstreamTimeout.totalTimeouts++;
      upstreamTimeout.timeoutRate = (upstreamTimeout.totalTimeouts / upstreamTimeout.totalRequests) * 100;
    }
  }

  /**
   * Update timeout distribution
   */
  private updateTimeoutDistribution(): void {
    if (this.timeoutDurations.length === 0) return;

    const sorted = [...this.timeoutDurations].sort((a, b) => a - b);
    
    this.timeoutMetrics.distribution.min = sorted[0] || 0;
    this.timeoutMetrics.distribution.max = sorted[sorted.length - 1] || 0;
    this.timeoutMetrics.distribution.avg =
      this.timeoutDurations.reduce((sum, d) => sum + d, 0) / this.timeoutDurations.length;

    // Calculate percentiles
    const p50Index = Math.floor(sorted.length * 0.5);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p99Index = Math.floor(sorted.length * 0.99);

    this.timeoutMetrics.distribution.p50 = sorted[p50Index] || 0;
    this.timeoutMetrics.distribution.p95 = sorted[p95Index] || 0;
    this.timeoutMetrics.distribution.p99 = sorted[p99Index] || 0;
  }

  /**
   * Record circuit breaker state change for Phase 8
   */
  recordCircuitBreakerStateChange(
    upstreamId: string,
    oldState: CircuitBreakerState,
    newState: CircuitBreakerState,
    timeInState: number
  ): void {
    if (!this.config.enabled || !this.config.collectCircuitBreaker) return;

    // Track transitions
    if (oldState === CircuitBreakerState.CLOSED && newState === CircuitBreakerState.OPEN) {
      this.circuitBreakerMetrics.transitions.closedToOpen++;
    } else if (oldState === CircuitBreakerState.OPEN && newState === CircuitBreakerState.HALF_OPEN) {
      this.circuitBreakerMetrics.transitions.openToHalfOpen++;
    } else if (oldState === CircuitBreakerState.HALF_OPEN && newState === CircuitBreakerState.CLOSED) {
      this.circuitBreakerMetrics.transitions.halfOpenToClosed++;
      this.circuitBreakerMetrics.successfulRecoveries++;
    } else if (oldState === CircuitBreakerState.HALF_OPEN && newState === CircuitBreakerState.OPEN) {
      this.circuitBreakerMetrics.transitions.halfOpenToOpen++;
    }

    // Update time in state
    if (oldState === CircuitBreakerState.CLOSED) {
      this.circuitBreakerMetrics.timeInState.closed += timeInState;
    } else if (oldState === CircuitBreakerState.OPEN) {
      this.circuitBreakerMetrics.timeInState.open += timeInState;
    } else if (oldState === CircuitBreakerState.HALF_OPEN) {
      this.circuitBreakerMetrics.timeInState.halfOpen += timeInState;
    }

    // Update per-upstream state
    const upstreamState: UpstreamCircuitBreakerState = {
      upstreamId,
      state: newState,
      lastStateChange: Date.now(),
      timeInCurrentState: 0,
      rejectedRequests: 0,
    };
    this.circuitBreakerMetrics.byUpstream.set(upstreamId, upstreamState);
  }

  /**
   * Record circuit breaker rejection for Phase 8
   */
  recordCircuitBreakerRejection(upstreamId: string): void {
    if (!this.config.enabled || !this.config.collectCircuitBreaker) return;

    this.circuitBreakerMetrics.rejectedRequests++;

    // Update per-upstream rejection count
    const upstreamState = this.circuitBreakerMetrics.byUpstream.get(upstreamId);
    if (upstreamState) {
      upstreamState.rejectedRequests++;
    }
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
    errorRates?: ErrorRateMetrics;
    retryStats?: RetryStatistics;
    timeouts?: TimeoutMetrics;
    circuitBreaker?: CircuitBreakerMetrics;
  } {
    const metrics: ReturnType<typeof this.getMetrics> = {
      requestTransformations: { ...this.requestTransformations },
      responseTransformations: { ...this.responseTransformations },
      compression: { ...this.compressionMetrics },
      decompression: { ...this.decompressionMetrics },
      webSocket: { ...this.wsMetrics },
      routes: Array.from(this.routeMetrics.values()),
      upstreams: Array.from(this.upstreamMetrics.values()),
      errors: { ...this.errorMetrics },
    };

    // Add Phase 8 metrics if enabled
    if (this.config.collectErrorRates) {
      metrics.errorRates = {
        windows: { ...this.errorRateMetrics.windows },
        byRoute: new Map(this.errorRateMetrics.byRoute),
        byUpstream: new Map(this.errorRateMetrics.byUpstream),
      };
    }

    if (this.config.collectRetryStats) {
      metrics.retryStats = {
        ...this.retryStatistics,
        byUpstream: new Map(this.retryStatistics.byUpstream),
      };
    }

    if (this.config.collectTimeouts) {
      metrics.timeouts = {
        ...this.timeoutMetrics,
        byRoute: new Map(this.timeoutMetrics.byRoute),
        byUpstream: new Map(this.timeoutMetrics.byUpstream),
      };
    }

    if (this.config.collectCircuitBreaker) {
      metrics.circuitBreaker = {
        ...this.circuitBreakerMetrics,
        byUpstream: new Map(this.circuitBreakerMetrics.byUpstream),
      };
    }

    return metrics;
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
    
    // Phase 8: Reset new metrics
    this.errorRateMetrics = this.createErrorRateMetrics();
    this.errorRateHistory = [];
    this.retryStatistics = this.createRetryStatistics();
    this.timeoutMetrics = this.createTimeoutMetrics();
    this.timeoutDurations = [];
    this.circuitBreakerMetrics = this.createCircuitBreakerMetrics();

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

  /**
   * Create error rate metrics object (Phase 8)
   */
  private createErrorRateMetrics(): ErrorRateMetrics {
    const emptyWindow = (): TimeWindowMetrics => ({
      totalRequests: 0,
      totalErrors: 0,
      errorRate: 0,
      errorsByType: this.createErrorMetrics(),
      windowStart: Date.now(),
    });

    return {
      windows: {
        oneMinute: emptyWindow(),
        fiveMinute: emptyWindow(),
        fifteenMinute: emptyWindow(),
      },
      byRoute: new Map(),
      byUpstream: new Map(),
    };
  }

  /**
   * Create retry statistics object (Phase 8)
   */
  private createRetryStatistics(): RetryStatistics {
    return {
      totalAttempts: 0,
      successfulRetries: 0,
      failedRetries: 0,
      successRate: 0,
      avgRetryCount: 0,
      delays: {
        min: Infinity,
        max: 0,
        avg: 0,
        total: 0,
      },
      byUpstream: new Map(),
    };
  }

  /**
   * Create timeout metrics object (Phase 8)
   */
  private createTimeoutMetrics(): TimeoutMetrics {
    return {
      totalTimeouts: 0,
      byType: {
        connection: 0,
        request: 0,
        upstream: 0,
        plugin: 0,
      },
      byRoute: new Map(),
      byUpstream: new Map(),
      distribution: {
        min: Infinity,
        max: 0,
        avg: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      },
    };
  }

  /**
   * Create circuit breaker metrics object (Phase 8)
   */
  private createCircuitBreakerMetrics(): CircuitBreakerMetrics {
    return {
      transitions: {
        closedToOpen: 0,
        openToHalfOpen: 0,
        halfOpenToClosed: 0,
        halfOpenToOpen: 0,
      },
      timeInState: {
        closed: 0,
        open: 0,
        halfOpen: 0,
      },
      rejectedRequests: 0,
      successfulRecoveries: 0,
      byUpstream: new Map(),
    };
  }
}
