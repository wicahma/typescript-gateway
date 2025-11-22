/**
 * Dashboard API - REST API for observability dashboard
 * Phase 8: Monitoring & Observability
 * 
 * Features:
 * - Overall metrics summary
 * - Per-route metrics
 * - Per-upstream metrics
 * - Error breakdown
 * - Worker thread status
 * - Health check
 * - Historical metrics
 * 
 * Performance target: < 10ms per API call
 */

import { IncomingMessage, ServerResponse } from 'http';
import { AdvancedMetrics } from '../core/advanced-metrics.js';
import { MetricsAggregator } from '../core/metrics-aggregator.js';
import { MetricsExporter } from './metrics-exporter.js';
import { HealthChecker } from '../core/health-checker.js';
import { Tracer } from './tracing.js';
import { logger } from '../utils/logger.js';

/**
 * Dashboard API configuration
 */
export interface DashboardAPIConfig {
  /** Enable dashboard API */
  enabled: boolean;
  /** Base path for API endpoints */
  basePath: string;
  /** Enable CORS */
  enableCORS: boolean;
  /** Allowed origins for CORS */
  allowedOrigins?: string[];
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: DashboardAPIConfig = {
  enabled: true,
  basePath: '/api',
  enableCORS: true,
  allowedOrigins: ['*'],
};

/**
 * API response
 */
interface APIResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  timestamp: number;
}

/**
 * Dashboard API
 */
export class DashboardAPI {
  private config: DashboardAPIConfig;
  private advancedMetrics?: AdvancedMetrics;
  private aggregator?: MetricsAggregator;
  private exporter?: MetricsExporter;
  private healthChecker?: HealthChecker;
  private tracer?: Tracer;

  constructor(
    config: Partial<DashboardAPIConfig>,
    components?: {
      advancedMetrics?: AdvancedMetrics;
      aggregator?: MetricsAggregator;
      exporter?: MetricsExporter;
      healthChecker?: HealthChecker;
      tracer?: Tracer;
    }
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.advancedMetrics = components?.advancedMetrics;
    this.aggregator = components?.aggregator;
    this.exporter = components?.exporter;
    this.healthChecker = components?.healthChecker;
    this.tracer = components?.tracer;
  }

  /**
   * Handle dashboard API request
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    const url = req.url || '';
    const basePath = this.config.basePath;

    // Check if request is for dashboard API
    if (!url.startsWith(basePath)) {
      return false;
    }

    // Handle CORS preflight
    if (this.config.enableCORS && req.method === 'OPTIONS') {
      this.handleCORS(res);
      res.writeHead(204);
      res.end();
      return true;
    }

    // Set CORS headers
    if (this.config.enableCORS) {
      this.handleCORS(res);
    }

    // Extract path after base path
    const path = url.substring(basePath.length);

    try {
      // Route to appropriate handler
      const response = await this.route(path, req);
      this.sendResponse(res, 200, response);
      return true;
    } catch (error) {
      logger.error(`Dashboard API error: ${error}`);
      this.sendResponse(res, 500, {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
        timestamp: Date.now(),
      });
      return true;
    }
  }

  /**
   * Route request to handler
   */
  private async route(path: string, _req: IncomingMessage): Promise<APIResponse> {
    // Parse path and query
    const [pathname, queryString] = path.split('?');
    const query = this.parseQuery(queryString);

    switch (pathname) {
      case '/metrics/summary':
        return this.getMetricsSummary();
      
      case '/metrics/routes':
        return this.getRouteMetrics();
      
      case '/metrics/upstreams':
        return this.getUpstreamMetrics();
      
      case '/metrics/errors':
        return this.getErrorMetrics();
      
      case '/metrics/workers':
        return this.getWorkerMetrics();
      
      case '/metrics/history':
        return this.getHistoricalMetrics(query);
      
      case '/health':
        return this.getHealth();
      
      case '/metrics':
        return this.getPrometheusMetrics();
      
      case '/trace/stats':
        return this.getTraceStats();
      
      default:
        return {
          success: false,
          error: 'Endpoint not found',
          timestamp: Date.now(),
        };
    }
  }

  /**
   * Get metrics summary
   */
  private getMetricsSummary(): APIResponse {
    const snapshot = this.aggregator?.getSnapshot();
    const advancedMetrics = this.advancedMetrics?.getMetrics();

    return {
      success: true,
      data: {
        requests: {
          total: snapshot?.totalRequests || 0,
          errors: snapshot?.totalErrors || 0,
          errorRate: snapshot && snapshot.totalRequests > 0
            ? (snapshot.totalErrors / snapshot.totalRequests) * 100
            : 0,
          requestsPerSecond: 0, // TODO: Calculate from time window
        },
        latency: snapshot?.latency || {
          p50: 0,
          p95: 0,
          p99: 0,
          min: 0,
          max: 0,
          avg: 0,
        },
        connections: {
          active: snapshot?.activeConnections || 0,
        },
        bandwidth: {
          sent: snapshot?.totalBytesSent || 0,
          received: snapshot?.totalBytesReceived || 0,
        },
        errors: advancedMetrics?.errors || {},
        retryStats: advancedMetrics?.retryStats
          ? {
              total: advancedMetrics.retryStats.totalAttempts,
              successful: advancedMetrics.retryStats.successfulRetries,
              failed: advancedMetrics.retryStats.failedRetries,
              successRate: advancedMetrics.retryStats.successRate,
            }
          : undefined,
        timeouts: advancedMetrics?.timeouts
          ? {
              total: advancedMetrics.timeouts.totalTimeouts,
              byType: advancedMetrics.timeouts.byType,
            }
          : undefined,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Get per-route metrics
   */
  private getRouteMetrics(): APIResponse {
    const metrics = this.advancedMetrics?.getMetrics();
    const routes = metrics?.routes || [];

    return {
      success: true,
      data: {
        routes: routes.map(route => ({
          route: route.route,
          requests: route.requestCount,
          errors: route.errorCount,
          errorRate: route.requestCount > 0
            ? (route.errorCount / route.requestCount) * 100
            : 0,
          avgLatency: route.avgLatency,
          avgRequestSize: route.avgRequestSize,
          avgResponseSize: route.avgResponseSize,
        })),
        total: routes.length,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Get per-upstream metrics
   */
  private getUpstreamMetrics(): APIResponse {
    const metrics = this.advancedMetrics?.getMetrics();
    const upstreams = metrics?.upstreams || [];
    const healthReport = this.healthChecker?.getHealthReport();

    return {
      success: true,
      data: {
        upstreams: upstreams.map(upstream => {
          const health = healthReport?.upstreams.find(u => u.id === upstream.upstreamId);
          
          return {
            id: upstream.upstreamId,
            requests: upstream.requestCount,
            errors: upstream.errorCount,
            successRate: upstream.requestCount > 0
              ? (upstream.successCount / upstream.requestCount) * 100
              : 0,
            avgLatency: upstream.avgLatency,
            health: health?.status || 'unknown',
            lastCheck: health?.lastCheck,
          };
        }),
        total: upstreams.length,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Get error metrics breakdown
   */
  private getErrorMetrics(): APIResponse {
    const metrics = this.advancedMetrics?.getMetrics();

    return {
      success: true,
      data: {
        errors: metrics?.errors || {},
        errorRates: metrics?.errorRates
          ? {
              windows: metrics.errorRates.windows,
              byRoute: Array.from(metrics.errorRates.byRoute.values()),
              byUpstream: Array.from(metrics.errorRates.byUpstream.values()),
            }
          : undefined,
        circuitBreaker: metrics?.circuitBreaker
          ? {
              transitions: metrics.circuitBreaker.transitions,
              rejectedRequests: metrics.circuitBreaker.rejectedRequests,
              successfulRecoveries: metrics.circuitBreaker.successfulRecoveries,
            }
          : undefined,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Get worker thread metrics
   */
  private getWorkerMetrics(): APIResponse {
    // TODO: Implement worker thread metrics collection
    return {
      success: true,
      data: {
        workers: {
          total: 1, // Single process for now
          healthy: 1,
          unhealthy: 0,
        },
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Get historical metrics
   */
  private getHistoricalMetrics(query: Record<string, string>): APIResponse {
    const windowMinutes = parseInt(query['window'] || '60', 10);
    const historical = this.exporter?.getHistoricalData(windowMinutes);

    return {
      success: true,
      data: {
        window: `${windowMinutes}m`,
        data: historical || [],
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Get health status
   */
  private getHealth(): APIResponse {
    const health = this.healthChecker?.getHealthReport();
    const snapshot = this.aggregator?.getSnapshot();

    return {
      success: true,
      data: {
        status: health?.status || 'unknown',
        timestamp: health?.timestamp || new Date().toISOString(),
        uptime: health?.uptime || process.uptime() * 1000,
        workers: {
          total: 1, // Single process for now
          healthy: 1,
          unhealthy: 0,
        },
        upstreams: health?.upstreams || [],
        metrics: {
          requestsPerSecond: 0, // TODO: Calculate
          errorRate: snapshot && snapshot.totalRequests > 0
            ? (snapshot.totalErrors / snapshot.totalRequests) * 100
            : 0,
          p99Latency: snapshot?.latency.p99 || 0,
        },
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Get Prometheus metrics
   */
  private getPrometheusMetrics(): APIResponse {
    const prometheusData = this.exporter?.exportPrometheus() || '';

    return {
      success: true,
      data: prometheusData,
      timestamp: Date.now(),
    };
  }

  /**
   * Get trace statistics
   */
  private getTraceStats(): APIResponse {
    const stats = this.tracer?.getStats();

    return {
      success: true,
      data: stats || {},
      timestamp: Date.now(),
    };
  }

  /**
   * Handle CORS headers
   */
  private handleCORS(res: ServerResponse): void {
    const allowedOrigins = this.config.allowedOrigins || ['*'];
    const origin = allowedOrigins[0] === '*' ? '*' : allowedOrigins.join(',');
    
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  }

  /**
   * Send JSON response
   */
  private sendResponse(res: ServerResponse, statusCode: number, data: APIResponse): void {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
    });
    res.end(JSON.stringify(data));
  }

  /**
   * Parse query string
   */
  private parseQuery(queryString?: string): Record<string, string> {
    if (!queryString) return {};

    const params: Record<string, string> = {};
    const pairs = queryString.split('&');

    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key) {
        params[decodeURIComponent(key)] = decodeURIComponent(value || '');
      }
    }

    return params;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<DashboardAPIConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
