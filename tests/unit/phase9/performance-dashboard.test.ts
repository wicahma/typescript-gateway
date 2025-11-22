/**
 * Unit tests for Performance Dashboard
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PerformanceDashboard, EventStream } from '../../../src/monitoring/performance-dashboard.js';

describe('PerformanceDashboard', () => {
  let dashboard: PerformanceDashboard;

  beforeEach(() => {
    dashboard = new PerformanceDashboard();
  });

  afterEach(async () => {
    await dashboard.stop();
  });

  it('should create dashboard', () => {
    expect(dashboard).toBeDefined();
  });

  it('should get real-time metrics stream', () => {
    const stream = dashboard.getRealTimeMetrics();
    expect(stream).toBeInstanceOf(EventStream);
  });

  it('should get historical metrics', () => {
    const timeRange = {
      from: Date.now() - 60000,
      to: Date.now(),
    };
    
    const historical = dashboard.getHistoricalMetrics(timeRange);
    expect(historical).toHaveProperty('timeRange');
    expect(historical).toHaveProperty('metrics');
    expect(historical).toHaveProperty('aggregates');
  });

  it('should get worker metrics', () => {
    const workers = dashboard.getWorkerMetrics();
    expect(Array.isArray(workers)).toBe(true);
  });

  it('should update metrics', () => {
    const point = {
      timestamp: Date.now(),
      latency: { p50: 1, p95: 2, p99: 3 },
      throughput: 10000,
      errorRate: 0.001,
      memoryUsage: 50000000,
    };
    
    dashboard.updateMetrics(point);
    
    const historical = dashboard.getHistoricalMetrics({
      from: point.timestamp - 1000,
      to: point.timestamp + 1000,
    });
    
    expect(historical.metrics.length).toBeGreaterThan(0);
  });

  it('should get connected clients count', () => {
    const count = dashboard.getConnectedClients();
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

describe('EventStream', () => {
  it('should create event stream', () => {
    const stream = new EventStream();
    expect(stream).toBeDefined();
  });

  it('should get client count', () => {
    const stream = new EventStream();
    expect(stream.getClientCount()).toBe(0);
  });
});
