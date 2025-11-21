/**
 * Load balancing algorithms for upstream selection
 * Phase 4: Upstream Integration & Resilience
 * 
 * Performance target: < 0.1ms for load balancing decision
 */

import { UpstreamTarget, LoadBalancerStrategy, HealthStatus } from '../types/core.js';
import { logger } from '../utils/logger.js';
import { createHash } from 'crypto';

/**
 * Load balancer metrics
 */
export interface LoadBalancerMetrics {
  /** Total requests */
  totalRequests: number;
  /** Requests per upstream */
  requestsPerUpstream: Map<string, number>;
  /** Errors per upstream */
  errorsPerUpstream: Map<string, number>;
  /** Average latency per upstream */
  latencyPerUpstream: Map<string, number>;
  /** Health status per upstream */
  healthPerUpstream: Map<string, HealthStatus>;
}

/**
 * Load balancer context for a request
 */
export interface LoadBalancerContext {
  /** Client IP address for IP hash */
  clientIp?: string;
  /** Session ID for session affinity */
  sessionId?: string;
  /** Request path */
  path?: string;
}

/**
 * Load balancer implementation
 */
export class LoadBalancer {
  private strategy: LoadBalancerStrategy;
  private upstreams: UpstreamTarget[] = [];
  private currentIndex = 0;
  private metrics: LoadBalancerMetrics;
  private healthAware: boolean = true;

  constructor(strategy: LoadBalancerStrategy = 'round-robin', healthAware: boolean = true) {
    this.strategy = strategy;
    this.healthAware = healthAware;
    this.metrics = this.initMetrics();
  }

  /**
   * Set upstreams
   */
  setUpstreams(upstreams: UpstreamTarget[]): void {
    this.upstreams = upstreams;
    this.currentIndex = 0;
  }

  /**
   * Select upstream based on strategy
   */
  select(context?: LoadBalancerContext): UpstreamTarget | null {
    const startTime = process.hrtime.bigint();

    // Filter healthy upstreams
    const availableUpstreams = this.healthAware
      ? this.upstreams.filter((u) => u.healthy !== false)
      : this.upstreams;

    if (availableUpstreams.length === 0) {
      logger.warn('No healthy upstreams available');
      return null;
    }

    let selected: UpstreamTarget | null = null;

    switch (this.strategy) {
      case 'round-robin':
        selected = this.roundRobin(availableUpstreams);
        break;
      case 'least-connections':
        selected = this.leastConnections(availableUpstreams);
        break;
      case 'weighted-round-robin':
        selected = this.weightedRoundRobin(availableUpstreams);
        break;
      case 'ip-hash':
        selected = this.ipHash(availableUpstreams, context?.clientIp);
        break;
      case 'random':
        selected = this.random(availableUpstreams);
        break;
      default:
        selected = this.roundRobin(availableUpstreams);
    }

    if (selected) {
      this.updateMetrics(selected);
    }

    const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    logger.debug(`Load balancer selected upstream in ${duration.toFixed(3)}ms`);

    return selected;
  }

  /**
   * Round Robin algorithm
   */
  private roundRobin(upstreams: UpstreamTarget[]): UpstreamTarget {
    const selected = upstreams[this.currentIndex % upstreams.length];
    if (!selected) {
      throw new Error('No upstream available');
    }
    this.currentIndex = (this.currentIndex + 1) % upstreams.length;
    return selected;
  }

  /**
   * Least Connections algorithm
   */
  private leastConnections(upstreams: UpstreamTarget[]): UpstreamTarget {
    let minConnections = Infinity;
    let selected = upstreams[0];

    if (!selected) {
      throw new Error('No upstream available');
    }

    for (const upstream of upstreams) {
      const connections = upstream.activeConnections || 0;
      if (connections < minConnections) {
        minConnections = connections;
        selected = upstream;
      }
    }

    return selected;
  }

  /**
   * Weighted Round Robin algorithm
   */
  private weightedRoundRobin(upstreams: UpstreamTarget[]): UpstreamTarget {
    // Build weighted list
    const weighted: UpstreamTarget[] = [];
    for (const upstream of upstreams) {
      const weight = upstream.weight || 1;
      for (let i = 0; i < weight; i++) {
        weighted.push(upstream);
      }
    }

    if (weighted.length === 0) {
      const fallback = upstreams[0];
      if (!fallback) {
        throw new Error('No upstream available');
      }
      return fallback;
    }

    const selected = weighted[this.currentIndex % weighted.length];
    if (!selected) {
      throw new Error('No upstream available');
    }
    this.currentIndex = (this.currentIndex + 1) % weighted.length;
    return selected;
  }

  /**
   * IP Hash algorithm for session affinity
   */
  private ipHash(upstreams: UpstreamTarget[], clientIp?: string): UpstreamTarget {
    if (!clientIp) {
      logger.warn('No client IP provided for IP hash, falling back to round robin');
      return this.roundRobin(upstreams);
    }

    // Hash client IP to select upstream
    const hash = createHash('md5').update(clientIp).digest('hex');
    const index = parseInt(hash.substring(0, 8), 16) % upstreams.length;
    const selected = upstreams[index];
    if (!selected) {
      throw new Error('No upstream available');
    }
    return selected;
  }

  /**
   * Random algorithm
   */
  private random(upstreams: UpstreamTarget[]): UpstreamTarget {
    const index = Math.floor(Math.random() * upstreams.length);
    const selected = upstreams[index];
    if (!selected) {
      throw new Error('No upstream available');
    }
    return selected;
  }

  /**
   * Update metrics
   */
  private updateMetrics(upstream: UpstreamTarget): void {
    this.metrics.totalRequests++;

    const currentCount = this.metrics.requestsPerUpstream.get(upstream.id) || 0;
    this.metrics.requestsPerUpstream.set(upstream.id, currentCount + 1);
  }

  /**
   * Record error for upstream
   */
  recordError(upstream: UpstreamTarget): void {
    const currentErrors = this.metrics.errorsPerUpstream.get(upstream.id) || 0;
    this.metrics.errorsPerUpstream.set(upstream.id, currentErrors + 1);
  }

  /**
   * Record latency for upstream
   */
  recordLatency(upstream: UpstreamTarget, latency: number): void {
    const currentLatency = this.metrics.latencyPerUpstream.get(upstream.id) || 0;
    const currentCount = this.metrics.requestsPerUpstream.get(upstream.id) || 1;

    // Calculate moving average
    const newAverage = (currentLatency * (currentCount - 1) + latency) / currentCount;
    this.metrics.latencyPerUpstream.set(upstream.id, newAverage);
  }

  /**
   * Update health status
   */
  updateHealth(upstream: UpstreamTarget, status: HealthStatus): void {
    this.metrics.healthPerUpstream.set(upstream.id, status);

    // Update upstream healthy flag
    upstream.healthy = status === HealthStatus.HEALTHY;
  }

  /**
   * Get metrics
   */
  getMetrics(): LoadBalancerMetrics {
    return {
      ...this.metrics,
      requestsPerUpstream: new Map(this.metrics.requestsPerUpstream),
      errorsPerUpstream: new Map(this.metrics.errorsPerUpstream),
      latencyPerUpstream: new Map(this.metrics.latencyPerUpstream),
      healthPerUpstream: new Map(this.metrics.healthPerUpstream),
    };
  }

  /**
   * Get strategy
   */
  getStrategy(): LoadBalancerStrategy {
    return this.strategy;
  }

  /**
   * Set strategy
   */
  setStrategy(strategy: LoadBalancerStrategy): void {
    this.strategy = strategy;
    this.currentIndex = 0;
    logger.info(`Load balancer strategy changed to ${strategy}`);
  }

  /**
   * Enable/disable health-aware routing
   */
  setHealthAware(enabled: boolean): void {
    this.healthAware = enabled;
    logger.info(`Health-aware routing ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get distribution statistics
   */
  getDistribution(): Map<string, number> {
    const distribution = new Map<string, number>();
    const total = this.metrics.totalRequests;

    if (total === 0) return distribution;

    for (const [upstreamId, count] of this.metrics.requestsPerUpstream.entries()) {
      const percentage = (count / total) * 100;
      distribution.set(upstreamId, percentage);
    }

    return distribution;
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = this.initMetrics();
    logger.info('Load balancer metrics reset');
  }

  /**
   * Initialize metrics
   */
  private initMetrics(): LoadBalancerMetrics {
    return {
      totalRequests: 0,
      requestsPerUpstream: new Map(),
      errorsPerUpstream: new Map(),
      latencyPerUpstream: new Map(),
      healthPerUpstream: new Map(),
    };
  }
}
