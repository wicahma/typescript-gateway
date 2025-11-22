/**
 * Integration tests for monitoring system
 */
import { describe, it, expect, afterEach } from 'vitest';
import { PerformanceDashboard } from '../../../src/monitoring/performance-dashboard.js';
import { PerformanceAlerter } from '../../../src/monitoring/performance-alerts.js';
import { AutoTuner } from '../../../src/config/auto-tuner.js';

describe('Monitoring Integration', () => {
  let dashboard: PerformanceDashboard;
  let alerter: PerformanceAlerter;
  let tuner: AutoTuner;

  beforeEach(() => {
    dashboard = new PerformanceDashboard();
    alerter = new PerformanceAlerter({ enabled: true });
    tuner = new AutoTuner({
      enabled: true,
      observationWindow: 1000,
      minObservations: 3,
      safeMode: true,
      aggressiveness: 'moderate',
    });
  });

  afterEach(async () => {
    await dashboard.stop();
    tuner.stopTuning();
  });

  it('should integrate dashboard with alerts', () => {
    const metrics = {
      latencyP99: 15,
      latencyP95: 10,
      latencyP50: 5,
      rps: 10000,
      errorRate: 0.01,
      memoryGrowthRate: 5,
      gcPauseP99: 50,
      circuitBreakerOpen: false,
      connectionPoolUtilization: 0.5,
    };
    
    const alerts = alerter.checkAlerts(metrics);
    
    for (const alert of alerts) {
      dashboard.addAlert({
        id: alert.id,
        severity: alert.severity,
        message: alert.message,
        timestamp: alert.timestamp,
        metric: alert.ruleName,
        value: 0,
        threshold: 0,
      });
    }
    
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('should integrate auto-tuner with monitoring', () => {
    const pattern = {
      avgRPS: 10000,
      peakRPS: 15000,
      avgLatency: 5,
      p99Latency: 10,
      errorRate: 0.01,
      memoryUsage: 50000000,
      cpuUsage: 0.5,
      activeConnections: 50,
    };
    
    tuner.recordLoadPattern(pattern);
    tuner.recordLoadPattern(pattern);
    tuner.recordLoadPattern(pattern);
    
    const recommendations = tuner.getRecommendations();
    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('should update dashboard with real-time metrics', () => {
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
});
