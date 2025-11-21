/**
 * Unit tests for Load Balancer
 * Phase 4: Upstream Integration & Resilience
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LoadBalancer } from '../../src/core/load-balancer.js';
import { UpstreamTarget, HealthStatus } from '../../src/types/core.js';

describe('LoadBalancer', () => {
  let upstreams: UpstreamTarget[];

  beforeEach(() => {
    upstreams = [
      createMockUpstream('upstream-1', 'localhost', 8001, 1, true),
      createMockUpstream('upstream-2', 'localhost', 8002, 1, true),
      createMockUpstream('upstream-3', 'localhost', 8003, 2, true),
    ];
  });

  describe('Round Robin', () => {
    it('should distribute requests evenly', () => {
      const lb = new LoadBalancer('round-robin');
      lb.setUpstreams(upstreams);

      const selections = [];
      for (let i = 0; i < 6; i++) {
        const upstream = lb.select();
        selections.push(upstream?.id);
      }

      expect(selections).toEqual([
        'upstream-1',
        'upstream-2',
        'upstream-3',
        'upstream-1',
        'upstream-2',
        'upstream-3',
      ]);
    });

    it('should cycle through upstreams', () => {
      const lb = new LoadBalancer('round-robin');
      lb.setUpstreams(upstreams);

      for (let i = 0; i < 10; i++) {
        const upstream = lb.select();
        expect(upstream).toBeDefined();
      }
    });

    it('should handle single upstream', () => {
      const lb = new LoadBalancer('round-robin');
      const singleUpstream = upstreams[0];
      if (!singleUpstream) throw new Error('Test setup error');
      lb.setUpstreams([singleUpstream]);

      for (let i = 0; i < 5; i++) {
        const upstream = lb.select();
        expect(upstream?.id).toBe('upstream-1');
      }
    });
  });

  describe('Least Connections', () => {
    it('should select upstream with fewest connections', () => {
      const lb = new LoadBalancer('least-connections');
      upstreams[0]!.activeConnections = 5;
      upstreams[1]!.activeConnections = 2;
      upstreams[2]!.activeConnections = 8;
      lb.setUpstreams(upstreams);

      const upstream = lb.select();
      expect(upstream?.id).toBe('upstream-2');
    });

    it('should handle zero connections', () => {
      const lb = new LoadBalancer('least-connections');
      upstreams[0]!.activeConnections = 5;
      upstreams[1]!.activeConnections = 0;
      upstreams[2]!.activeConnections = 3;
      lb.setUpstreams(upstreams);

      const upstream = lb.select();
      expect(upstream?.id).toBe('upstream-2');
    });

    it('should select first when connections are equal', () => {
      const lb = new LoadBalancer('least-connections');
      upstreams[0]!.activeConnections = 2;
      upstreams[1]!.activeConnections = 2;
      upstreams[2]!.activeConnections = 2;
      lb.setUpstreams(upstreams);

      const upstream = lb.select();
      expect(upstream?.id).toBe('upstream-1');
    });
  });

  describe('Weighted Round Robin', () => {
    it('should respect weights', () => {
      const lb = new LoadBalancer('weighted-round-robin');
      lb.setUpstreams(upstreams);

      const selections: Record<string, number> = {};
      for (let i = 0; i < 12; i++) {
        const upstream = lb.select();
        if (upstream) {
          selections[upstream.id] = (selections[upstream.id] || 0) + 1;
        }
      }

      // upstream-1: weight 1 -> 3 selections (25%)
      // upstream-2: weight 1 -> 3 selections (25%)
      // upstream-3: weight 2 -> 6 selections (50%)
      expect(selections['upstream-1']).toBe(3);
      expect(selections['upstream-2']).toBe(3);
      expect(selections['upstream-3']).toBe(6);
    });

    it('should handle default weight', () => {
      const lb = new LoadBalancer('weighted-round-robin');
      const noWeightUpstreams = upstreams.map((u) => ({ ...u, weight: undefined }));
      lb.setUpstreams(noWeightUpstreams);

      const upstream = lb.select();
      expect(upstream).toBeDefined();
    });
  });

  describe('IP Hash', () => {
    it('should consistently route same IP to same upstream', () => {
      const lb = new LoadBalancer('ip-hash');
      lb.setUpstreams(upstreams);

      const clientIp = '192.168.1.100';
      const selections = [];

      for (let i = 0; i < 5; i++) {
        const upstream = lb.select({ clientIp });
        selections.push(upstream?.id);
      }

      // All selections should be the same
      expect(new Set(selections).size).toBe(1);
    });

    it('should distribute different IPs across upstreams', () => {
      const lb = new LoadBalancer('ip-hash');
      lb.setUpstreams(upstreams);

      const ips = ['192.168.1.1', '192.168.1.2', '192.168.1.3', '192.168.1.4', '192.168.1.5'];
      const selections = ips.map((ip) => lb.select({ clientIp: ip })?.id);

      // Should have distribution (not all the same)
      expect(new Set(selections).size).toBeGreaterThan(1);
    });

    it('should fallback to round robin without IP', () => {
      const lb = new LoadBalancer('ip-hash');
      lb.setUpstreams(upstreams);

      const upstream = lb.select();
      expect(upstream).toBeDefined();
    });
  });

  describe('Random', () => {
    it('should select random upstream', () => {
      const lb = new LoadBalancer('random');
      lb.setUpstreams(upstreams);

      const selections = new Set();
      for (let i = 0; i < 20; i++) {
        const upstream = lb.select();
        if (upstream) {
          selections.add(upstream.id);
        }
      }

      // Should have some variety in 20 selections
      expect(selections.size).toBeGreaterThan(1);
    });
  });

  describe('Health-aware routing', () => {
    it('should skip unhealthy upstreams', () => {
      const lb = new LoadBalancer('round-robin', true);
      upstreams[1]!.healthy = false;
      lb.setUpstreams(upstreams);

      const selections = [];
      for (let i = 0; i < 6; i++) {
        const upstream = lb.select();
        selections.push(upstream?.id);
      }

      // Should skip upstream-2 (unhealthy)
      expect(selections).not.toContain('upstream-2');
      expect(selections.filter((id) => id === 'upstream-1').length).toBe(3);
      expect(selections.filter((id) => id === 'upstream-3').length).toBe(3);
    });

    it('should return null when no healthy upstreams', () => {
      const lb = new LoadBalancer('round-robin', true);
      upstreams.forEach((u) => (u.healthy = false));
      lb.setUpstreams(upstreams);

      const upstream = lb.select();
      expect(upstream).toBeNull();
    });

    it('should route to all when health-aware disabled', () => {
      const lb = new LoadBalancer('round-robin', false);
      upstreams[1]!.healthy = false;
      lb.setUpstreams(upstreams);

      const selections = [];
      for (let i = 0; i < 6; i++) {
        const upstream = lb.select();
        selections.push(upstream?.id);
      }

      // Should include all upstreams, even unhealthy ones
      expect(selections).toContain('upstream-2');
    });
  });

  describe('Metrics', () => {
    it('should track total requests', () => {
      const lb = new LoadBalancer('round-robin');
      lb.setUpstreams(upstreams);

      for (let i = 0; i < 5; i++) {
        lb.select();
      }

      const metrics = lb.getMetrics();
      expect(metrics.totalRequests).toBe(5);
    });

    it('should track requests per upstream', () => {
      const lb = new LoadBalancer('round-robin');
      lb.setUpstreams(upstreams);

      for (let i = 0; i < 9; i++) {
        lb.select();
      }

      const metrics = lb.getMetrics();
      expect(metrics.requestsPerUpstream.get('upstream-1')).toBe(3);
      expect(metrics.requestsPerUpstream.get('upstream-2')).toBe(3);
      expect(metrics.requestsPerUpstream.get('upstream-3')).toBe(3);
    });

    it('should record errors', () => {
      const lb = new LoadBalancer('round-robin');
      lb.setUpstreams(upstreams);

      const upstream = lb.select();
      if (upstream) {
        lb.recordError(upstream);
        lb.recordError(upstream);
      }

      const metrics = lb.getMetrics();
      const upstreamErrors = metrics.errorsPerUpstream.get(upstream?.id || '');
      expect(upstreamErrors).toBe(2);
    });

    it('should record latency', () => {
      const lb = new LoadBalancer('round-robin');
      lb.setUpstreams(upstreams);

      const upstream = lb.select();
      if (upstream) {
        lb.recordLatency(upstream, 50);
        lb.recordLatency(upstream, 100);
      }

      const metrics = lb.getMetrics();
      const avgLatency = metrics.latencyPerUpstream.get(upstream?.id || '');
      // Latency should be recorded (value will depend on when recordLatency is called)
      expect(avgLatency).toBeGreaterThan(0);
      expect(avgLatency).toBeLessThanOrEqual(100);
    });

    it('should calculate distribution', () => {
      const lb = new LoadBalancer('round-robin');
      lb.setUpstreams(upstreams);

      for (let i = 0; i < 9; i++) {
        lb.select();
      }

      const distribution = lb.getDistribution();
      expect(distribution.get('upstream-1')).toBeCloseTo(33.33, 1);
      expect(distribution.get('upstream-2')).toBeCloseTo(33.33, 1);
      expect(distribution.get('upstream-3')).toBeCloseTo(33.33, 1);
    });
  });

  describe('Strategy switching', () => {
    it('should switch strategy dynamically', () => {
      const lb = new LoadBalancer('round-robin');
      lb.setUpstreams(upstreams);

      expect(lb.getStrategy()).toBe('round-robin');

      lb.setStrategy('random');
      expect(lb.getStrategy()).toBe('random');
    });

    it('should reset state when switching strategy', () => {
      const lb = new LoadBalancer('round-robin');
      lb.setUpstreams(upstreams);

      // Make some selections
      lb.select();
      lb.select();

      lb.setStrategy('random');

      // Should work with new strategy
      const upstream = lb.select();
      expect(upstream).toBeDefined();
    });
  });

  describe('Health status updates', () => {
    it('should update health status', () => {
      const lb = new LoadBalancer('round-robin');
      lb.setUpstreams(upstreams);

      const upstream = upstreams[0];
      if (upstream) {
        lb.updateHealth(upstream, HealthStatus.UNHEALTHY);

        expect(upstream.healthy).toBe(false);

        const metrics = lb.getMetrics();
        expect(metrics.healthPerUpstream.get(upstream.id)).toBe(HealthStatus.UNHEALTHY);
      }
    });

    it('should handle degraded status', () => {
      const lb = new LoadBalancer('round-robin');
      lb.setUpstreams(upstreams);

      const upstream = upstreams[0];
      if (upstream) {
        lb.updateHealth(upstream, HealthStatus.DEGRADED);

        // Degraded is not healthy
        expect(upstream.healthy).toBe(false);
      }
    });
  });

  describe('Performance', () => {
    it('should make selection quickly', () => {
      const lb = new LoadBalancer('round-robin');
      lb.setUpstreams(upstreams);

      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        lb.select();
      }

      const duration = Date.now() - start;
      const avgTime = duration / 1000;

      // Target: < 0.1ms per selection (but allow more in test environment)
      expect(avgTime).toBeLessThan(1);
    });
  });

  describe('Reset metrics', () => {
    it('should reset all metrics', () => {
      const lb = new LoadBalancer('round-robin');
      lb.setUpstreams(upstreams);

      for (let i = 0; i < 5; i++) {
        lb.select();
      }

      lb.resetMetrics();

      const metrics = lb.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.requestsPerUpstream.size).toBe(0);
    });
  });
});

// Helper function
function createMockUpstream(
  id: string,
  host: string,
  port: number,
  weight: number,
  healthy: boolean
): UpstreamTarget {
  return {
    id,
    protocol: 'http',
    host,
    port,
    basePath: '',
    poolSize: 10,
    timeout: 30000,
    healthCheck: {
      enabled: true,
      interval: 10000,
      timeout: 5000,
      path: '/health',
      expectedStatus: 200,
    },
    healthy,
    circuitBreaker: 0, // CircuitBreakerState.CLOSED
    weight,
    activeConnections: 0,
  };
}
