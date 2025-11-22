/**
 * Unit tests for MetricsAggregator
 * Phase 8: Monitoring & Observability
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsAggregator } from '../../src/core/metrics-aggregator.js';

describe('MetricsAggregator', () => {
  let aggregator: MetricsAggregator;

  beforeEach(() => {
    aggregator = new MetricsAggregator({
      useSharedMemory: false, // Disable SharedArrayBuffer for tests
      windowSize: 100,
      windowDuration: 1000,
    });
  });

  describe('Constructor', () => {
    it('should create aggregator with default configuration', () => {
      const agg = new MetricsAggregator();
      expect(agg).toBeDefined();
      
      const stats = agg.getStats();
      expect(stats.bufferSize).toBe(310);
      expect(stats.windowSize).toBe(10000);
      expect(stats.windowDuration).toBe(60000);
    });

    it('should create aggregator with custom configuration', () => {
      const agg = new MetricsAggregator({
        windowSize: 500,
        windowDuration: 5000,
      });
      
      const stats = agg.getStats();
      expect(stats.windowSize).toBe(500);
      expect(stats.windowDuration).toBe(5000);
    });
  });

  describe('Request Recording', () => {
    it('should record successful request', () => {
      aggregator.recordRequest(10, false);
      
      const snapshot = aggregator.getSnapshot();
      expect(snapshot.totalRequests).toBe(1);
      expect(snapshot.totalErrors).toBe(0);
    });

    it('should record failed request', () => {
      aggregator.recordRequest(10, true);
      
      const snapshot = aggregator.getSnapshot();
      expect(snapshot.totalRequests).toBe(1);
      expect(snapshot.totalErrors).toBe(1);
    });

    it('should record multiple requests', () => {
      aggregator.recordRequest(10, false);
      aggregator.recordRequest(15, false);
      aggregator.recordRequest(20, true);
      
      const snapshot = aggregator.getSnapshot();
      expect(snapshot.totalRequests).toBe(3);
      expect(snapshot.totalErrors).toBe(1);
    });

    it('should track latency in histogram', () => {
      aggregator.recordRequest(10, false);
      aggregator.recordRequest(20, false);
      aggregator.recordRequest(30, false);
      
      const snapshot = aggregator.getSnapshot();
      expect(snapshot.latency.min).toBeGreaterThan(0);
      expect(snapshot.latency.max).toBeGreaterThan(0);
      expect(snapshot.latency.avg).toBeGreaterThan(0);
    });
  });

  describe('Size Recording', () => {
    it('should record request size', () => {
      aggregator.recordRequest(10, false); // Need to record a request first
      aggregator.recordRequestSize(1024);
      aggregator.recordRequestSize(2048);
      
      const snapshot = aggregator.getWindowSnapshot();
      expect(snapshot.requestSize.avg).toBeGreaterThan(0);
    });

    it('should record response size', () => {
      aggregator.recordRequest(10, false); // Need to record a request first
      aggregator.recordResponseSize(4096);
      aggregator.recordResponseSize(8192);
      
      const snapshot = aggregator.getWindowSnapshot();
      expect(snapshot.responseSize.avg).toBeGreaterThan(0);
    });
  });

  describe('Bytes Tracking', () => {
    it('should track bytes sent and received', () => {
      aggregator.recordBytes(1000, 2000);
      aggregator.recordBytes(1500, 2500);
      
      const snapshot = aggregator.getSnapshot();
      expect(snapshot.totalBytesSent).toBe(2500);
      expect(snapshot.totalBytesReceived).toBe(4500);
    });
  });

  describe('Active Connections', () => {
    it('should update active connections', () => {
      aggregator.updateActiveConnections(5);
      
      let snapshot = aggregator.getSnapshot();
      expect(snapshot.activeConnections).toBe(5);
      
      aggregator.updateActiveConnections(-2);
      snapshot = aggregator.getSnapshot();
      expect(snapshot.activeConnections).toBe(3);
    });
  });

  describe('Snapshot', () => {
    it('should return current metrics snapshot', () => {
      aggregator.recordRequest(10, false);
      aggregator.recordRequestSize(1024);
      aggregator.recordResponseSize(2048);
      aggregator.recordBytes(1000, 2000);
      
      const snapshot = aggregator.getSnapshot();
      
      expect(snapshot).toMatchObject({
        totalRequests: 1,
        totalErrors: 0,
        totalBytesSent: 1000,
        totalBytesReceived: 2000,
      });
      
      expect(snapshot.timestamp).toBeGreaterThan(0);
      expect(snapshot.latency).toBeDefined();
      expect(snapshot.requestSize).toBeDefined();
      expect(snapshot.responseSize).toBeDefined();
    });
  });

  describe('Window Snapshot', () => {
    it('should return window-based snapshot', () => {
      aggregator.recordRequest(10, false);
      aggregator.recordRequest(15, false);
      aggregator.recordRequest(20, false);
      
      const snapshot = aggregator.getWindowSnapshot();
      
      expect(snapshot.totalRequests).toBe(3);
      expect(snapshot.latency.p50).toBeGreaterThan(0);
      expect(snapshot.latency.p95).toBeGreaterThan(0);
      expect(snapshot.latency.p99).toBeGreaterThan(0);
    });

    it('should calculate percentiles from window', () => {
      // Add requests with varying latencies
      for (let i = 1; i <= 10; i++) {
        aggregator.recordRequest(i * 10, false);
      }
      
      const snapshot = aggregator.getWindowSnapshot();
      
      expect(snapshot.latency.p50).toBeLessThanOrEqual(snapshot.latency.p95);
      expect(snapshot.latency.p95).toBeLessThanOrEqual(snapshot.latency.p99);
    });
  });

  describe('Reset', () => {
    it('should reset all metrics', () => {
      aggregator.recordRequest(10, false);
      aggregator.recordBytes(1000, 2000);
      aggregator.updateActiveConnections(5);
      
      aggregator.reset();
      
      const snapshot = aggregator.getSnapshot();
      expect(snapshot.totalRequests).toBe(0);
      expect(snapshot.totalErrors).toBe(0);
      expect(snapshot.totalBytesSent).toBe(0);
      expect(snapshot.totalBytesReceived).toBe(0);
      expect(snapshot.activeConnections).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should return aggregator statistics', () => {
      const stats = aggregator.getStats();
      
      expect(stats).toMatchObject({
        useSharedMemory: false,
        bufferSize: 310,
        windowSize: 100,
        windowDuration: 1000,
      });
      
      expect(stats.latencyWindowEntries).toBe(0);
      expect(stats.requestSizeWindowEntries).toBe(0);
      expect(stats.responseSizeWindowEntries).toBe(0);
    });

    it('should track window entries', () => {
      aggregator.recordRequest(10, false);
      aggregator.recordRequestSize(1024);
      aggregator.recordResponseSize(2048);
      
      const stats = aggregator.getStats();
      expect(stats.latencyWindowEntries).toBe(1);
      expect(stats.requestSizeWindowEntries).toBe(1);
      expect(stats.responseSizeWindowEntries).toBe(1);
    });
  });

  describe('Latency Percentiles', () => {
    it('should calculate accurate latency percentiles', () => {
      // Add 100 requests with latencies from 1ms to 100ms
      for (let i = 1; i <= 100; i++) {
        aggregator.recordRequest(i, false);
      }
      
      const snapshot = aggregator.getWindowSnapshot();
      
      // P50 should be around 50ms
      expect(snapshot.latency.p50).toBeGreaterThan(40);
      expect(snapshot.latency.p50).toBeLessThan(60);
      
      // P95 should be around 95ms
      expect(snapshot.latency.p95).toBeGreaterThan(90);
      
      // P99 should be around 99ms
      expect(snapshot.latency.p99).toBeGreaterThan(95);
    });

    it('should handle single request', () => {
      aggregator.recordRequest(50, false);
      
      const snapshot = aggregator.getWindowSnapshot();
      
      expect(snapshot.latency.p50).toBe(50);
      expect(snapshot.latency.p95).toBe(50);
      expect(snapshot.latency.p99).toBe(50);
      expect(snapshot.latency.avg).toBe(50);
    });

    it('should handle empty metrics', () => {
      const snapshot = aggregator.getSnapshot();
      
      expect(snapshot.latency.p50).toBe(0);
      expect(snapshot.latency.p95).toBe(0);
      expect(snapshot.latency.p99).toBe(0);
    });
  });

  describe('Atomic Operations', () => {
    it('should use atomic operations for counters', () => {
      // Test that multiple concurrent updates work correctly
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        promises.push(
          Promise.resolve().then(() => {
            aggregator.recordRequest(10, false);
          })
        );
      }
      
      return Promise.all(promises).then(() => {
        const snapshot = aggregator.getSnapshot();
        expect(snapshot.totalRequests).toBe(10);
      });
    });
  });

  describe('SharedArrayBuffer', () => {
    it('should support SharedArrayBuffer when available', () => {
      const agg = new MetricsAggregator({ useSharedMemory: true });
      
      // SharedArrayBuffer support depends on environment
      const stats = agg.getStats();
      expect(stats.useSharedMemory).toBeDefined();
    });

    it('should fallback to regular buffer when SharedArrayBuffer unavailable', () => {
      const agg = new MetricsAggregator({ useSharedMemory: false });
      
      const stats = agg.getStats();
      expect(stats.useSharedMemory).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large latencies', () => {
      aggregator.recordRequest(10000, false);
      
      const snapshot = aggregator.getSnapshot();
      expect(snapshot.latency.max).toBeGreaterThan(0);
    });

    it('should handle very small latencies', () => {
      aggregator.recordRequest(0.1, false);
      
      const snapshot = aggregator.getSnapshot();
      expect(snapshot.latency.min).toBeGreaterThanOrEqual(0);
    });

    it('should handle zero latencies', () => {
      aggregator.recordRequest(0, false);
      
      const snapshot = aggregator.getSnapshot();
      expect(snapshot.totalRequests).toBe(1);
    });
  });
});
