/**
 * Lock-free metrics collector
 * High-performance metrics using atomic operations where possible
 */

import { MetricsSnapshot } from '../types/core.js';

/**
 * Latency histogram for percentile calculations
 * Fixed-size circular buffer for memory efficiency
 */
class LatencyHistogram {
  private samples: number[];
  private index: number = 0;
  private size: number;
  private filled: boolean = false;

  constructor(size: number = 10000) {
    this.size = size;
    this.samples = new Array(size).fill(0);
  }

  /**
   * Record latency sample
   */
  record(latencyMs: number): void {
    this.samples[this.index] = latencyMs;
    this.index = (this.index + 1) % this.size;

    if (this.index === 0) {
      this.filled = true;
    }
  }

  /**
   * Calculate percentile
   */
  percentile(p: number): number {
    const validSamples = this.filled ? this.samples : this.samples.slice(0, this.index);

    if (validSamples.length === 0) {
      return 0;
    }

    const sorted = validSamples.slice().sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[index] || 0;
  }

  /**
   * Calculate average
   */
  average(): number {
    const validSamples = this.filled ? this.samples : this.samples.slice(0, this.index);

    if (validSamples.length === 0) {
      return 0;
    }

    const sum = validSamples.reduce((acc, val) => acc + val, 0);
    return sum / validSamples.length;
  }

  /**
   * Clear histogram
   */
  clear(): void {
    this.samples.fill(0);
    this.index = 0;
    this.filled = false;
  }
}

/**
 * Metrics collector for gateway performance monitoring
 * Uses lock-free counters and circular buffers
 */
export class MetricsCollector {
  private totalRequests: number = 0;
  private totalErrors: number = 0;
  private activeConnections: number = 0;
  private startTime: number = Date.now();
  private lastResetTime: number = Date.now();
  private histogram: LatencyHistogram;

  constructor(histogramSize: number = 10000) {
    this.histogram = new LatencyHistogram(histogramSize);
  }

  /**
   * Record incoming request
   */
  recordRequest(): void {
    this.totalRequests++;
  }

  /**
   * Record request completion with latency
   */
  recordLatency(startTime: bigint): void {
    const endTime = process.hrtime.bigint();
    const latencyNs = endTime - startTime;
    const latencyMs = Number(latencyNs) / 1_000_000; // Convert to milliseconds
    this.histogram.record(latencyMs);
  }

  /**
   * Record error
   */
  recordError(): void {
    this.totalErrors++;
  }

  /**
   * Increment active connections
   */
  incrementConnections(): void {
    this.activeConnections++;
  }

  /**
   * Decrement active connections
   */
  decrementConnections(): void {
    this.activeConnections--;
  }

  /**
   * Get current metrics snapshot
   */
  snapshot(): MetricsSnapshot {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastResetTime) / 1000;
    const requestsPerSecond = elapsedSeconds > 0 ? this.totalRequests / elapsedSeconds : 0;

    return {
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      requestsPerSecond: Math.round(requestsPerSecond),
      avgLatency: this.histogram.average(),
      p50Latency: this.histogram.percentile(50),
      p95Latency: this.histogram.percentile(95),
      p99Latency: this.histogram.percentile(99),
      activeConnections: this.activeConnections,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      timestamp: now,
    };
  }

  /**
   * Reset metrics (for periodic reporting)
   */
  reset(): void {
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.lastResetTime = Date.now();
    this.histogram.clear();
  }

  /**
   * Get uptime in seconds
   */
  getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  /**
   * Format metrics for logging
   */
  format(): string {
    const metrics = this.snapshot();
    return [
      `Requests: ${metrics.totalRequests}`,
      `Errors: ${metrics.totalErrors}`,
      `RPS: ${metrics.requestsPerSecond}`,
      `Latency: avg=${metrics.avgLatency.toFixed(2)}ms, p50=${metrics.p50Latency.toFixed(2)}ms, p95=${metrics.p95Latency.toFixed(2)}ms, p99=${metrics.p99Latency.toFixed(2)}ms`,
      `Connections: ${metrics.activeConnections}`,
      `Memory: ${Math.round(metrics.memoryUsage.heapUsed / 1024 / 1024)}MB`,
    ].join(' | ');
  }
}

// Export singleton instance
export const metrics = new MetricsCollector();
