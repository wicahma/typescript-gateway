/**
 * Unit tests for Performance Alerts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PerformanceAlerter } from '../../../src/monitoring/performance-alerts.js';

describe('PerformanceAlerter', () => {
  let alerter: PerformanceAlerter;

  beforeEach(() => {
    alerter = new PerformanceAlerter({ enabled: true });
    alerter.clearAlerts();
  });

  it('should create alerter', () => {
    expect(alerter).toBeDefined();
  });

  it('should have built-in rules', () => {
    const rules = alerter.getRules();
    expect(rules.length).toBeGreaterThan(0);
  });

  it('should check alerts', () => {
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
    expect(Array.isArray(alerts)).toBe(true);
  });

  it('should trigger latency alert', () => {
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
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]?.severity).toBe('critical');
  });

  it('should respect cooldown', () => {
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
    
    alerter.checkAlerts(metrics);
    const alerts2 = alerter.checkAlerts(metrics);
    
    expect(alerts2.length).toBe(0);
  });

  it('should add custom rule', () => {
    alerter.addRule({
      name: 'custom-rule',
      condition: (m) => m.rps > 100000,
      severity: 'warning',
      cooldown: 60000,
    });
    
    const rules = alerter.getRules();
    expect(rules.find(r => r.name === 'custom-rule')).toBeDefined();
  });

  it('should enable/disable', () => {
    alerter.disable();
    expect(alerter.isEnabled()).toBe(false);
    
    alerter.enable();
    expect(alerter.isEnabled()).toBe(true);
  });

  it('should get active alerts', () => {
    const alerts = alerter.getActiveAlerts();
    expect(Array.isArray(alerts)).toBe(true);
  });
});
