/**
 * Health check system for upstream monitoring
 * Phase 4: Upstream Integration & Resilience
 * 
 * Performance: Run in separate worker, minimal impact on request handling
 */

import http from 'http';
import https from 'https';
import { Socket } from 'net';
import { UpstreamTarget, HealthCheckConfig, HealthCheckType, HealthStatus } from '../types/core.js';
import { logger } from '../utils/logger.js';

/**
 * Health check result
 */
export interface HealthCheckResult {
  /** Upstream ID */
  upstreamId: string;
  /** Health status */
  status: HealthStatus;
  /** Response time in milliseconds */
  responseTime: number;
  /** Timestamp */
  timestamp: number;
  /** Error message if failed */
  error?: string;
  /** Check type used */
  checkType: HealthCheckType;
}

/**
 * Health check statistics
 */
export interface HealthCheckStats {
  /** Total checks performed */
  totalChecks: number;
  /** Successful checks */
  successfulChecks: number;
  /** Failed checks */
  failedChecks: number;
  /** Average response time */
  avgResponseTime: number;
  /** Last check result */
  lastResult?: HealthCheckResult;
  /** Consecutive failures */
  consecutiveFailures: number;
  /** Consecutive successes */
  consecutiveSuccesses: number;
}

/**
 * Default health check configuration
 */
const DEFAULT_CONFIG: HealthCheckConfig = {
  enabled: true,
  interval: 10000, // 10 seconds
  timeout: 5000, // 5 seconds
  path: '/health',
  expectedStatus: 200,
  type: 'active',
  gracePeriod: 5000, // 5 seconds
  unhealthyThreshold: 3, // 3 consecutive failures
  healthyThreshold: 2, // 2 consecutive successes
};

/**
 * Health checker implementation
 */
export class HealthChecker {
  private upstreams: Map<string, UpstreamTarget> = new Map();
  private stats: Map<string, HealthCheckStats> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private running = false;

  /**
   * Start health checking
   */
  start(upstreams: UpstreamTarget[]): void {
    if (this.running) {
      logger.warn('Health checker already running');
      return;
    }

    this.running = true;

    // Initialize upstreams
    for (const upstream of upstreams) {
      this.addUpstream(upstream);
    }

    logger.info(`Health checker started for ${upstreams.length} upstreams`);
  }

  /**
   * Stop health checking
   */
  stop(): void {
    this.running = false;

    // Clear all intervals
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }

    this.intervals.clear();
    logger.info('Health checker stopped');
  }

  /**
   * Add upstream to health checking
   */
  addUpstream(upstream: UpstreamTarget): void {
    if (!upstream.healthCheck.enabled) {
      logger.debug(`Health check disabled for upstream ${upstream.id}`);
      return;
    }

    this.upstreams.set(upstream.id, upstream);

    // Initialize stats
    this.stats.set(upstream.id, {
      totalChecks: 0,
      successfulChecks: 0,
      failedChecks: 0,
      avgResponseTime: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
    });

    // Start periodic health checks
    const config = { ...DEFAULT_CONFIG, ...upstream.healthCheck };
    const interval = setInterval(() => {
      this.performHealthCheck(upstream, config);
    }, config.interval);

    this.intervals.set(upstream.id, interval);

    // Perform initial check
    this.performHealthCheck(upstream, config);

    logger.info(`Health checking started for upstream ${upstream.id}`);
  }

  /**
   * Remove upstream from health checking
   */
  removeUpstream(upstreamId: string): void {
    const interval = this.intervals.get(upstreamId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(upstreamId);
    }

    this.upstreams.delete(upstreamId);
    this.stats.delete(upstreamId);

    logger.info(`Health checking stopped for upstream ${upstreamId}`);
  }

  /**
   * Perform health check
   */
  private async performHealthCheck(
    upstream: UpstreamTarget,
    config: HealthCheckConfig
  ): Promise<void> {
    const checkType = config.type || 'active';

    try {
      let result: HealthCheckResult;

      switch (checkType) {
        case 'active':
          result = await this.performActiveCheck(upstream, config);
          break;
        case 'passive':
          result = this.performPassiveCheck(upstream);
          break;
        case 'hybrid':
          // Try active first, fallback to passive
          try {
            result = await this.performActiveCheck(upstream, config);
          } catch {
            result = this.performPassiveCheck(upstream);
          }
          break;
        default:
          result = await this.performActiveCheck(upstream, config);
      }

      this.processResult(upstream, result, config);
    } catch (error) {
      logger.error(`Health check error for ${upstream.id}: ${error}`);
    }
  }

  /**
   * Perform active HTTP health check
   */
  private performActiveCheck(
    upstream: UpstreamTarget,
    config: HealthCheckConfig
  ): Promise<HealthCheckResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const isHttps = upstream.protocol === 'https';
      const client = isHttps ? https : http;

      const options = {
        hostname: upstream.host,
        port: upstream.port,
        path: config.path,
        method: 'GET',
        timeout: config.timeout,
      };

      const req = client.request(options, (res) => {
        const responseTime = Date.now() - startTime;
        const isHealthy = res.statusCode === config.expectedStatus;

        res.on('data', () => {
          // Drain response
        });

        res.on('end', () => {
          resolve({
            upstreamId: upstream.id,
            status: isHealthy ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
            responseTime,
            timestamp: Date.now(),
            error: isHealthy ? undefined : `Unexpected status code: ${res.statusCode}`,
            checkType: 'active',
          });
        });
      });

      req.on('error', (error) => {
        resolve({
          upstreamId: upstream.id,
          status: HealthStatus.UNHEALTHY,
          responseTime: Date.now() - startTime,
          timestamp: Date.now(),
          error: error.message,
          checkType: 'active',
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          upstreamId: upstream.id,
          status: HealthStatus.UNHEALTHY,
          responseTime: Date.now() - startTime,
          timestamp: Date.now(),
          error: 'Health check timeout',
          checkType: 'active',
        });
      });

      req.end();
    });
  }

  /**
   * Perform passive health check (based on actual traffic)
   */
  private performPassiveCheck(upstream: UpstreamTarget): HealthCheckResult {
    const stats = this.stats.get(upstream.id);

    if (!stats || !stats.lastResult) {
      return {
        upstreamId: upstream.id,
        status: HealthStatus.HEALTHY, // Assume healthy initially
        responseTime: 0,
        timestamp: Date.now(),
        checkType: 'passive',
      };
    }

    // Use last result
    return {
      ...stats.lastResult,
      checkType: 'passive',
    };
  }

  /**
   * Perform TCP health check
   */
  async performTCPCheck(
    upstream: UpstreamTarget,
    config: HealthCheckConfig
  ): Promise<HealthCheckResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const socket = new Socket();

      const timer = setTimeout(() => {
        socket.destroy();
        resolve({
          upstreamId: upstream.id,
          status: HealthStatus.UNHEALTHY,
          responseTime: Date.now() - startTime,
          timestamp: Date.now(),
          error: 'TCP connection timeout',
          checkType: 'active',
        });
      }, config.timeout);

      socket.connect(upstream.port, upstream.host, () => {
        clearTimeout(timer);
        socket.end();
        resolve({
          upstreamId: upstream.id,
          status: HealthStatus.HEALTHY,
          responseTime: Date.now() - startTime,
          timestamp: Date.now(),
          checkType: 'active',
        });
      });

      socket.on('error', (error) => {
        clearTimeout(timer);
        socket.destroy();
        resolve({
          upstreamId: upstream.id,
          status: HealthStatus.UNHEALTHY,
          responseTime: Date.now() - startTime,
          timestamp: Date.now(),
          error: error.message,
          checkType: 'active',
        });
      });
    });
  }

  /**
   * Process health check result
   */
  private processResult(
    upstream: UpstreamTarget,
    result: HealthCheckResult,
    config: HealthCheckConfig
  ): void {
    const stats = this.stats.get(upstream.id);
    if (!stats) return;

    // Update stats
    stats.totalChecks++;
    stats.lastResult = result;

    // Update response time average
    if (result.responseTime > 0) {
      stats.avgResponseTime =
        (stats.avgResponseTime * (stats.totalChecks - 1) + result.responseTime) /
        stats.totalChecks;
    }

    // Update consecutive counters
    if (result.status === HealthStatus.HEALTHY) {
      stats.successfulChecks++;
      stats.consecutiveSuccesses++;
      stats.consecutiveFailures = 0;
    } else {
      stats.failedChecks++;
      stats.consecutiveFailures++;
      stats.consecutiveSuccesses = 0;
    }

    // Determine if status should change
    const unhealthyThreshold = config.unhealthyThreshold || 3;
    const healthyThreshold = config.healthyThreshold || 2;

    let newStatus = upstream.healthy ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY;

    if (stats.consecutiveFailures >= unhealthyThreshold) {
      newStatus = HealthStatus.UNHEALTHY;
    } else if (stats.consecutiveSuccesses >= healthyThreshold) {
      newStatus = HealthStatus.HEALTHY;
    }

    // Apply grace period for newly added upstreams
    const gracePeriod = config.gracePeriod || 0;
    const timeSinceFirstCheck = Date.now() - (stats.lastResult?.timestamp || Date.now());
    if (timeSinceFirstCheck < gracePeriod) {
      newStatus = HealthStatus.HEALTHY; // Keep healthy during grace period
    }

    // Update upstream health status
    if (newStatus !== (upstream.healthy ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY)) {
      upstream.healthy = newStatus === HealthStatus.HEALTHY;
      logger.info(
        `Upstream ${upstream.id} health status changed to ${newStatus}`
      );
    }
  }

  /**
   * Get health status for upstream
   */
  getHealth(upstreamId: string): HealthStatus {
    const upstream = this.upstreams.get(upstreamId);
    if (!upstream) return HealthStatus.UNHEALTHY;
    return upstream.healthy ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY;
  }

  /**
   * Get statistics for upstream
   */
  getStats(upstreamId: string): HealthCheckStats | undefined {
    return this.stats.get(upstreamId);
  }

  /**
   * Get all statistics
   */
  getAllStats(): Map<string, HealthCheckStats> {
    return new Map(this.stats);
  }

  /**
   * Record passive health check from actual request
   */
  recordPassiveCheck(upstreamId: string, success: boolean, responseTime: number): void {
    const upstream = this.upstreams.get(upstreamId);
    if (!upstream) return;

    const result: HealthCheckResult = {
      upstreamId,
      status: success ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
      responseTime,
      timestamp: Date.now(),
      error: success ? undefined : 'Request failed',
      checkType: 'passive',
    };

    const config = { ...DEFAULT_CONFIG, ...upstream.healthCheck };
    this.processResult(upstream, result, config);
  }
}
