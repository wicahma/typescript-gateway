/**
 * Metrics Exporter - Pluggable metrics export system
 * Phase 8: Monitoring & Observability
 * 
 * Features:
 * - Prometheus format export
 * - JSON format export
 * - Configurable aggregation intervals
 * - Label support
 * 
 * Performance target: < 10ms for metrics endpoint response
 */

import { AdvancedMetrics } from '../core/advanced-metrics.js';
import { MetricsAggregator, MetricsSnapshot } from '../core/metrics-aggregator.js';
import { logger } from '../utils/logger.js';

/**
 * Metric type
 */
export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  SUMMARY = 'summary',
}

/**
 * Metric definition
 */
export interface MetricDefinition {
  /** Metric name */
  name: string;
  /** Metric type */
  type: MetricType;
  /** Help text */
  help: string;
  /** Labels */
  labels?: Record<string, string>;
  /** Value */
  value: number | Record<string, number>;
}

/**
 * Exporter configuration
 */
export interface ExporterConfig {
  /** Prometheus export configuration */
  prometheus?: {
    enabled: boolean;
    prefix?: string;
  };
  /** JSON export configuration */
  json?: {
    enabled: boolean;
    pretty?: boolean;
    includeHistorical?: boolean;
  };
}

/**
 * Historical metrics
 */
interface HistoricalMetrics {
  timestamp: number;
  snapshot: MetricsSnapshot;
}

/**
 * Metrics Exporter
 */
export class MetricsExporter {
  private config: ExporterConfig;
  private advancedMetrics?: AdvancedMetrics;
  private aggregator?: MetricsAggregator;
  private historicalMetrics: HistoricalMetrics[] = [];
  private maxHistoricalEntries = 1440; // 24 hours at 1 minute intervals

  constructor(
    config: ExporterConfig,
    advancedMetrics?: AdvancedMetrics,
    aggregator?: MetricsAggregator
  ) {
    this.config = config;
    this.advancedMetrics = advancedMetrics;
    this.aggregator = aggregator;

    // Start collecting historical metrics if JSON export is enabled
    if (config.json?.enabled && config.json?.includeHistorical) {
      this.startHistoricalCollection();
    }
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheus(): string {
    if (!this.config.prometheus?.enabled) {
      return '';
    }

    const prefix = this.config.prometheus.prefix || 'gateway';
    const lines: string[] = [];

    // Get snapshot from aggregator
    const snapshot = this.aggregator?.getSnapshot();

    if (snapshot) {
      // Total requests counter
      lines.push(`# HELP ${prefix}_requests_total Total number of requests`);
      lines.push(`# TYPE ${prefix}_requests_total counter`);
      lines.push(`${prefix}_requests_total ${snapshot.totalRequests}`);

      // Total errors counter
      lines.push(`# HELP ${prefix}_errors_total Total number of errors`);
      lines.push(`# TYPE ${prefix}_errors_total counter`);
      lines.push(`${prefix}_errors_total ${snapshot.totalErrors}`);

      // Active connections gauge
      lines.push(`# HELP ${prefix}_active_connections Current number of active connections`);
      lines.push(`# TYPE ${prefix}_active_connections gauge`);
      lines.push(`${prefix}_active_connections ${snapshot.activeConnections}`);

      // Bytes sent counter
      lines.push(`# HELP ${prefix}_bytes_sent_total Total bytes sent`);
      lines.push(`# TYPE ${prefix}_bytes_sent_total counter`);
      lines.push(`${prefix}_bytes_sent_total ${snapshot.totalBytesSent}`);

      // Bytes received counter
      lines.push(`# HELP ${prefix}_bytes_received_total Total bytes received`);
      lines.push(`# TYPE ${prefix}_bytes_received_total counter`);
      lines.push(`${prefix}_bytes_received_total ${snapshot.totalBytesReceived}`);

      // Request duration histogram
      lines.push(
        `# HELP ${prefix}_request_duration_seconds Request duration in seconds`
      );
      lines.push(`# TYPE ${prefix}_request_duration_seconds histogram`);
      lines.push(
        `${prefix}_request_duration_seconds{quantile="0.5"} ${snapshot.latency.p50 / 1000}`
      );
      lines.push(
        `${prefix}_request_duration_seconds{quantile="0.95"} ${snapshot.latency.p95 / 1000}`
      );
      lines.push(
        `${prefix}_request_duration_seconds{quantile="0.99"} ${snapshot.latency.p99 / 1000}`
      );
      lines.push(
        `${prefix}_request_duration_seconds_sum ${(snapshot.latency.avg * snapshot.totalRequests) / 1000}`
      );
      lines.push(`${prefix}_request_duration_seconds_count ${snapshot.totalRequests}`);
    }

    // Add advanced metrics
    if (this.advancedMetrics) {
      const metrics = this.advancedMetrics.getMetrics();

      // Error breakdown
      lines.push(`# HELP ${prefix}_errors_by_type Errors by type`);
      lines.push(`# TYPE ${prefix}_errors_by_type counter`);
      lines.push(`${prefix}_errors_by_type{type="client"} ${metrics.errors.clientErrors}`);
      lines.push(`${prefix}_errors_by_type{type="server"} ${metrics.errors.serverErrors}`);
      lines.push(
        `${prefix}_errors_by_type{type="network"} ${metrics.errors.networkErrors}`
      );
      lines.push(
        `${prefix}_errors_by_type{type="timeout"} ${metrics.errors.timeoutErrors}`
      );
      lines.push(
        `${prefix}_errors_by_type{type="circuit_breaker"} ${metrics.errors.circuitBreakerErrors}`
      );
      lines.push(
        `${prefix}_errors_by_type{type="transformation"} ${metrics.errors.transformationErrors}`
      );

      // Per-route metrics
      if (metrics.routes.length > 0) {
        lines.push(`# HELP ${prefix}_route_requests_total Requests per route`);
        lines.push(`# TYPE ${prefix}_route_requests_total counter`);
        for (const route of metrics.routes) {
          lines.push(
            `${prefix}_route_requests_total{route="${this.escapeLabel(route.route)}"} ${route.requestCount}`
          );
        }

        lines.push(`# HELP ${prefix}_route_errors_total Errors per route`);
        lines.push(`# TYPE ${prefix}_route_errors_total counter`);
        for (const route of metrics.routes) {
          lines.push(
            `${prefix}_route_errors_total{route="${this.escapeLabel(route.route)}"} ${route.errorCount}`
          );
        }

        lines.push(`# HELP ${prefix}_route_latency_seconds Route latency in seconds`);
        lines.push(`# TYPE ${prefix}_route_latency_seconds gauge`);
        for (const route of metrics.routes) {
          lines.push(
            `${prefix}_route_latency_seconds{route="${this.escapeLabel(route.route)}"} ${route.avgLatency / 1000}`
          );
        }
      }

      // Per-upstream metrics
      if (metrics.upstreams.length > 0) {
        lines.push(`# HELP ${prefix}_upstream_requests_total Requests per upstream`);
        lines.push(`# TYPE ${prefix}_upstream_requests_total counter`);
        for (const upstream of metrics.upstreams) {
          lines.push(
            `${prefix}_upstream_requests_total{upstream="${this.escapeLabel(upstream.upstreamId)}"} ${upstream.requestCount}`
          );
        }

        lines.push(`# HELP ${prefix}_upstream_errors_total Errors per upstream`);
        lines.push(`# TYPE ${prefix}_upstream_errors_total counter`);
        for (const upstream of metrics.upstreams) {
          lines.push(
            `${prefix}_upstream_errors_total{upstream="${this.escapeLabel(upstream.upstreamId)}"} ${upstream.errorCount}`
          );
        }
      }

      // Retry statistics
      if (metrics.retryStats) {
        lines.push(`# HELP ${prefix}_retry_attempts_total Total retry attempts`);
        lines.push(`# TYPE ${prefix}_retry_attempts_total counter`);
        lines.push(`${prefix}_retry_attempts_total ${metrics.retryStats.totalAttempts}`);

        lines.push(`# HELP ${prefix}_retry_success_total Successful retries`);
        lines.push(`# TYPE ${prefix}_retry_success_total counter`);
        lines.push(
          `${prefix}_retry_success_total ${metrics.retryStats.successfulRetries}`
        );

        lines.push(`# HELP ${prefix}_retry_failed_total Failed retries`);
        lines.push(`# TYPE ${prefix}_retry_failed_total counter`);
        lines.push(`${prefix}_retry_failed_total ${metrics.retryStats.failedRetries}`);
      }

      // Timeout statistics
      if (metrics.timeouts) {
        lines.push(`# HELP ${prefix}_timeouts_total Total timeouts`);
        lines.push(`# TYPE ${prefix}_timeouts_total counter`);
        lines.push(`${prefix}_timeouts_total ${metrics.timeouts.totalTimeouts}`);

        lines.push(`# HELP ${prefix}_timeouts_by_type Timeouts by type`);
        lines.push(`# TYPE ${prefix}_timeouts_by_type counter`);
        lines.push(
          `${prefix}_timeouts_by_type{type="connection"} ${metrics.timeouts.byType.connection}`
        );
        lines.push(
          `${prefix}_timeouts_by_type{type="request"} ${metrics.timeouts.byType.request}`
        );
        lines.push(
          `${prefix}_timeouts_by_type{type="upstream"} ${metrics.timeouts.byType.upstream}`
        );
        lines.push(
          `${prefix}_timeouts_by_type{type="plugin"} ${metrics.timeouts.byType.plugin}`
        );
      }

      // Circuit breaker statistics
      if (metrics.circuitBreaker) {
        lines.push(
          `# HELP ${prefix}_circuit_breaker_transitions State transitions`
        );
        lines.push(`# TYPE ${prefix}_circuit_breaker_transitions counter`);
        lines.push(
          `${prefix}_circuit_breaker_transitions{from="closed",to="open"} ${metrics.circuitBreaker.transitions.closedToOpen}`
        );
        lines.push(
          `${prefix}_circuit_breaker_transitions{from="open",to="half_open"} ${metrics.circuitBreaker.transitions.openToHalfOpen}`
        );
        lines.push(
          `${prefix}_circuit_breaker_transitions{from="half_open",to="closed"} ${metrics.circuitBreaker.transitions.halfOpenToClosed}`
        );

        lines.push(
          `# HELP ${prefix}_circuit_breaker_rejected_total Rejected requests`
        );
        lines.push(`# TYPE ${prefix}_circuit_breaker_rejected_total counter`);
        lines.push(
          `${prefix}_circuit_breaker_rejected_total ${metrics.circuitBreaker.rejectedRequests}`
        );
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Export metrics in JSON format
   */
  exportJSON(pretty: boolean = false): string {
    if (!this.config.json?.enabled) {
      return '{}';
    }

    const snapshot = this.aggregator?.getSnapshot();
    const advancedMetrics = this.advancedMetrics?.getMetrics();

    const data = {
      timestamp: Date.now(),
      gateway: {
        requests: {
          total: snapshot?.totalRequests || 0,
          errors: snapshot?.totalErrors || 0,
          errorRate:
            snapshot && snapshot.totalRequests > 0
              ? (snapshot.totalErrors / snapshot.totalRequests) * 100
              : 0,
        },
        connections: {
          active: snapshot?.activeConnections || 0,
        },
        bandwidth: {
          sent: snapshot?.totalBytesSent || 0,
          received: snapshot?.totalBytesReceived || 0,
        },
        latency: snapshot?.latency || {
          p50: 0,
          p95: 0,
          p99: 0,
          min: 0,
          max: 0,
          avg: 0,
        },
      },
      errors: advancedMetrics?.errors || {},
      errorRates: advancedMetrics?.errorRates
        ? {
            windows: advancedMetrics.errorRates.windows,
            byRoute: Array.from(advancedMetrics.errorRates.byRoute.values()),
            byUpstream: Array.from(advancedMetrics.errorRates.byUpstream.values()),
          }
        : undefined,
      retryStats: advancedMetrics?.retryStats
        ? {
            ...advancedMetrics.retryStats,
            byUpstream: Array.from(advancedMetrics.retryStats.byUpstream.values()),
          }
        : undefined,
      timeouts: advancedMetrics?.timeouts
        ? {
            total: advancedMetrics.timeouts.totalTimeouts,
            byType: advancedMetrics.timeouts.byType,
            distribution: advancedMetrics.timeouts.distribution,
          }
        : undefined,
      circuitBreaker: advancedMetrics?.circuitBreaker
        ? {
            transitions: advancedMetrics.circuitBreaker.transitions,
            rejectedRequests: advancedMetrics.circuitBreaker.rejectedRequests,
            byUpstream: Array.from(advancedMetrics.circuitBreaker.byUpstream.values()),
          }
        : undefined,
      routes: advancedMetrics?.routes || [],
      upstreams: advancedMetrics?.upstreams || [],
      historical:
        this.config.json?.includeHistorical ? this.getHistoricalData() : undefined,
    };

    return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  }

  /**
   * Export metrics as object
   */
  exportObject(): Record<string, unknown> {
    const snapshot = this.aggregator?.getSnapshot();
    const advancedMetrics = this.advancedMetrics?.getMetrics();

    return {
      timestamp: Date.now(),
      snapshot,
      advancedMetrics,
    };
  }

  /**
   * Get historical data
   */
  getHistoricalData(windowMinutes: number = 60): HistoricalMetrics[] {
    const cutoff = Date.now() - windowMinutes * 60 * 1000;
    return this.historicalMetrics.filter((entry) => entry.timestamp >= cutoff);
  }

  /**
   * Start collecting historical metrics
   */
  private startHistoricalCollection(): void {
    // Collect metrics every minute
    setInterval(() => {
      const snapshot = this.aggregator?.getSnapshot();
      if (snapshot) {
        this.historicalMetrics.push({
          timestamp: Date.now(),
          snapshot,
        });

        // Trim old entries
        if (this.historicalMetrics.length > this.maxHistoricalEntries) {
          this.historicalMetrics.shift();
        }
      }
    }, 60000); // 1 minute

    logger.info('Historical metrics collection started');
  }

  /**
   * Escape label value for Prometheus
   */
  private escapeLabel(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ExporterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get export statistics
   */
  getStats(): {
    prometheusEnabled: boolean;
    jsonEnabled: boolean;
    historicalEntries: number;
  } {
    return {
      prometheusEnabled: this.config.prometheus?.enabled || false,
      jsonEnabled: this.config.json?.enabled || false,
      historicalEntries: this.historicalMetrics.length,
    };
  }
}
