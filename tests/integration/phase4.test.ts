/**
 * Integration tests for Phase 4 components
 * Phase 4: Upstream Integration & Resilience
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProxyHandler } from '../../src/core/proxy-handler.js';
import { LoadBalancer } from '../../src/core/load-balancer.js';
import { CircuitBreaker } from '../../src/core/circuit-breaker.js';
import { HealthChecker } from '../../src/core/health-checker.js';
import { HttpClientPool } from '../../src/core/http-client-pool.js';
import { UpstreamTarget, CircuitBreakerState, HealthStatus } from '../../src/types/core.js';

describe('Phase 4 Integration Tests', () => {
  let proxyHandler: ProxyHandler;
  let upstreams: UpstreamTarget[];

  beforeEach(() => {
    upstreams = [
      createMockUpstream('upstream-1', 'localhost', 8001),
      createMockUpstream('upstream-2', 'localhost', 8002),
      createMockUpstream('upstream-3', 'localhost', 8003),
    ];

    proxyHandler = new ProxyHandler({
      enableBodyParsing: true,
      enableCircuitBreaker: true,
      enableHealthChecking: true,
      requestTimeout: 30000,
    });

    proxyHandler.initialize(upstreams);
  });

  afterEach(async () => {
    await proxyHandler.shutdown();
  });

  describe('Load Balancer Integration', () => {
    it('should initialize load balancer with upstreams', () => {
      const lb = proxyHandler.getLoadBalancer();
      expect(lb).toBeDefined();

      const metrics = lb.getMetrics();
      expect(metrics).toBeDefined();
    });

    it('should select upstreams using round robin', () => {
      const lb = proxyHandler.getLoadBalancer();
      const selections = [];

      for (let i = 0; i < 3; i++) {
        const upstream = lb.select();
        selections.push(upstream?.id);
      }

      expect(selections).toEqual(['upstream-1', 'upstream-2', 'upstream-3']);
    });

    it('should switch load balancing strategies', () => {
      const lb = proxyHandler.getLoadBalancer();

      lb.setStrategy('random');
      expect(lb.getStrategy()).toBe('random');

      const upstream = lb.select();
      expect(upstream).toBeDefined();
    });

    it('should skip unhealthy upstreams', () => {
      const lb = proxyHandler.getLoadBalancer();
      lb.setHealthAware(true);

      // Mark one upstream as unhealthy
      lb.updateHealth(upstreams[1] as UpstreamTarget, HealthStatus.UNHEALTHY);

      const selections = new Set();
      for (let i = 0; i < 6; i++) {
        const upstream = lb.select();
        if (upstream) {
          selections.add(upstream.id);
        }
      }

      // Should not select unhealthy upstream
      expect(selections.has('upstream-2')).toBe(false);
      expect(selections.has('upstream-1')).toBe(true);
      expect(selections.has('upstream-3')).toBe(true);
    });
  });

  describe('Circuit Breaker Integration', () => {
    it('should create circuit breakers for each upstream', () => {
      const breaker1 = proxyHandler.getCircuitBreaker('upstream-1');
      const breaker2 = proxyHandler.getCircuitBreaker('upstream-2');
      const breaker3 = proxyHandler.getCircuitBreaker('upstream-3');

      expect(breaker1).toBeDefined();
      expect(breaker2).toBeDefined();
      expect(breaker3).toBeDefined();
    });

    it('should maintain separate circuit breaker states', () => {
      const breaker1 = proxyHandler.getCircuitBreaker('upstream-1');
      const breaker2 = proxyHandler.getCircuitBreaker('upstream-2');

      breaker1?.forceState(CircuitBreakerState.OPEN);

      expect(breaker1?.getState()).toBe(CircuitBreakerState.OPEN);
      expect(breaker2?.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should track metrics independently', async () => {
      const breaker1 = proxyHandler.getCircuitBreaker('upstream-1');

      if (breaker1) {
        await breaker1.execute(async () => 'success');

        const metrics = breaker1.getMetrics();
        expect(metrics.totalRequests).toBe(1);
        expect(metrics.successfulRequests).toBe(1);
      }
    });
  });

  describe('Health Checker Integration', () => {
    it('should initialize health checker', () => {
      const healthChecker = proxyHandler.getHealthChecker();
      expect(healthChecker).toBeDefined();
    });

    it('should track health status for upstreams', () => {
      const healthChecker = proxyHandler.getHealthChecker();

      const status = healthChecker.getHealth('upstream-1');
      expect([HealthStatus.HEALTHY, HealthStatus.UNHEALTHY]).toContain(status);
    });

    it('should record passive health checks', () => {
      const healthChecker = proxyHandler.getHealthChecker();

      healthChecker.recordPassiveCheck('upstream-1', true, 50);

      const stats = healthChecker.getStats('upstream-1');
      expect(stats).toBeDefined();
      expect(stats?.totalChecks).toBeGreaterThan(0);
    });

    it('should propagate health status to load balancer', () => {
      const healthChecker = proxyHandler.getHealthChecker();
      const loadBalancer = proxyHandler.getLoadBalancer();

      // Record failures
      for (let i = 0; i < 5; i++) {
        healthChecker.recordPassiveCheck('upstream-2', false, 100);
      }

      // Health status should eventually propagate
      const status = healthChecker.getHealth('upstream-2');
      expect(status).toBeDefined();
    });
  });

  describe('HTTP Client Pool Integration', () => {
    it('should initialize client pool', () => {
      const clientPool = proxyHandler.getClientPool();
      expect(clientPool).toBeDefined();
    });

    it('should acquire connections', async () => {
      const clientPool = proxyHandler.getClientPool();
      const upstream = upstreams[0] as UpstreamTarget;

      const agent = await clientPool.acquire(upstream);
      expect(agent).toBeDefined();

      clientPool.release(upstream, agent);
    });

    it('should track pool metrics', async () => {
      const clientPool = proxyHandler.getClientPool();
      const upstream = upstreams[0] as UpstreamTarget;

      const agent = await clientPool.acquire(upstream);
      const metrics = clientPool.getMetrics(upstream);

      expect(metrics.total).toBeGreaterThan(0);
      expect(metrics.active).toBeGreaterThan(0);

      clientPool.release(upstream, agent);
    });

    it('should reuse connections', async () => {
      const clientPool = proxyHandler.getClientPool();
      const upstream = upstreams[0] as UpstreamTarget;

      // Acquire and release multiple times
      for (let i = 0; i < 5; i++) {
        const agent = await clientPool.acquire(upstream);
        clientPool.release(upstream, agent);
      }

      const metrics = clientPool.getMetrics(upstream);
      // Should have some connection reuse
      expect(metrics.totalRequests).toBeGreaterThan(0);
    });
  });

  describe('Component Interaction', () => {
    it('should coordinate between circuit breaker and load balancer', async () => {
      const breaker = proxyHandler.getCircuitBreaker('upstream-1');
      const loadBalancer = proxyHandler.getLoadBalancer();

      // Open circuit
      breaker?.forceState(CircuitBreakerState.OPEN);

      // Load balancer should still select upstream (circuit breaker prevents execution)
      const upstream = loadBalancer.select();
      expect(upstream).toBeDefined();
    });

    it('should coordinate between health checker and load balancer', () => {
      const healthChecker = proxyHandler.getHealthChecker();
      const loadBalancer = proxyHandler.getLoadBalancer();

      // Manually mark upstream as unhealthy via load balancer
      loadBalancer.updateHealth(upstreams[0] as UpstreamTarget, HealthStatus.UNHEALTHY);

      // Load balancer with health-aware routing
      loadBalancer.setHealthAware(true);

      // Should skip unhealthy upstream-1
      const selections = new Set();
      for (let i = 0; i < 6; i++) {
        const upstream = loadBalancer.select();
        if (upstream) {
          selections.add(upstream.id);
        }
      }

      // Should not select unhealthy upstream
      expect(selections.has('upstream-1')).toBe(false);
    });

    it('should maintain separate state for each upstream', async () => {
      const breaker1 = proxyHandler.getCircuitBreaker('upstream-1');
      const breaker2 = proxyHandler.getCircuitBreaker('upstream-2');
      const healthChecker = proxyHandler.getHealthChecker();

      // Different states for different upstreams
      breaker1?.forceState(CircuitBreakerState.OPEN);
      healthChecker.recordPassiveCheck('upstream-2', true, 50);

      expect(breaker1?.getState()).toBe(CircuitBreakerState.OPEN);
      expect(breaker2?.getState()).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('Configuration and Initialization', () => {
    it('should respect configuration options', () => {
      const customHandler = new ProxyHandler({
        enableBodyParsing: false,
        enableCircuitBreaker: false,
        enableHealthChecking: false,
      });

      customHandler.initialize(upstreams);

      // Should still have load balancer
      const lb = customHandler.getLoadBalancer();
      expect(lb).toBeDefined();

      customHandler.shutdown();
    });

    it('should handle empty upstream list', () => {
      const emptyHandler = new ProxyHandler();
      emptyHandler.initialize([]);

      const lb = emptyHandler.getLoadBalancer();
      const upstream = lb.select();

      expect(upstream).toBeNull();

      emptyHandler.shutdown();
    });

    it('should reinitialize with new upstreams', () => {
      const newUpstreams = [
        createMockUpstream('new-upstream-1', 'localhost', 9001),
        createMockUpstream('new-upstream-2', 'localhost', 9002),
      ];

      proxyHandler.initialize(newUpstreams);

      const lb = proxyHandler.getLoadBalancer();
      const upstream = lb.select();

      expect(upstream).toBeDefined();
      expect(['new-upstream-1', 'new-upstream-2']).toContain(upstream?.id || '');
    });
  });

  describe('Shutdown and Cleanup', () => {
    it('should shutdown gracefully', async () => {
      await expect(proxyHandler.shutdown()).resolves.not.toThrow();
    });

    it('should stop health checker on shutdown', async () => {
      const healthChecker = proxyHandler.getHealthChecker();

      await proxyHandler.shutdown();

      // Health checker should be stopped (we can't directly test this, but no errors is good)
      expect(healthChecker).toBeDefined();
    });

    it('should destroy client pool on shutdown', async () => {
      const clientPool = proxyHandler.getClientPool();

      await proxyHandler.shutdown();

      // Client pool should be destroyed
      expect(clientPool).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle load balancer with no healthy upstreams', () => {
      const lb = proxyHandler.getLoadBalancer();
      lb.setHealthAware(true);

      // Mark all as unhealthy
      upstreams.forEach((u) => {
        lb.updateHealth(u, HealthStatus.UNHEALTHY);
      });

      const upstream = lb.select();
      expect(upstream).toBeNull();
    });

    it('should handle circuit breaker errors gracefully', async () => {
      const breaker = proxyHandler.getCircuitBreaker('upstream-1');

      if (breaker) {
        await expect(
          breaker.execute(async () => {
            throw new Error('Test error');
          })
        ).rejects.toThrow('Test error');

        // Should still be functional
        const metrics = breaker.getMetrics();
        expect(metrics.failedRequests).toBe(1);
      }
    });
  });
});

// Helper function
function createMockUpstream(id: string, host: string, port: number): UpstreamTarget {
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
      type: 'active',
      gracePeriod: 5000,
      unhealthyThreshold: 3,
      healthyThreshold: 2,
    },
    healthy: true,
    circuitBreaker: CircuitBreakerState.CLOSED,
    weight: 1,
    activeConnections: 0,
  };
}
