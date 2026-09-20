import { describe, it, expect } from 'vitest';
import { HttpClientPool } from '../../src/core/http-client-pool.js';
import { UpstreamTarget } from '../../src/types/core.js';

const upstream: UpstreamTarget = {
  id: 'u1', protocol: 'http', host: '127.0.0.1', port: 1,
  basePath: '', poolSize: 10, timeout: 30000,
  healthCheck: { enabled: false, path: '/health', interval: 30000, timeout: 5000, expectedStatus: 200, type: 'active', gracePeriod: 5000, unhealthyThreshold: 3, healthyThreshold: 2 },
  healthy: true, circuitBreaker: 0 as never, weight: 1, activeConnections: 0,
};

describe('HttpClientPool acquire fast-path', () => {
  it('returns an agent without hrtime duration overhead (semantics unchanged)', async () => {
    const pool = new HttpClientPool();
    const agent1 = await pool.acquire(upstream);
    expect(agent1).toBeDefined();
    pool.release(upstream, agent1);

    const agent2 = await pool.acquire(upstream);
    expect(agent2).toBe(agent1);

    const m = pool.getMetrics(upstream);
    expect(m.totalRequests).toBe(2);
    expect(m.reusedConnections).toBe(1);
    expect(m.active).toBe(1);
    pool.destroy();
  });

  it('tracks reuse rate and active/idle counts identically to the slow path', async () => {
    const pool = new HttpClientPool();
    const a = await pool.acquire(upstream);
    const b = await pool.acquire(upstream);
    expect(a).not.toBe(b);
    pool.release(upstream, a);
    pool.release(upstream, b);
    const c = await pool.acquire(upstream);
    const m = pool.getMetrics(upstream);
    expect(m.total).toBe(2);
    expect(m.totalRequests).toBe(3);
    expect(m.reusedConnections).toBe(1);
    expect(c).toBe(a);
    pool.destroy();
  });

  it('bench: acquire+release per-op overhead is under 5µs in the warm pool case', async () => {
    const pool = new HttpClientPool();
    const agent = await pool.acquire(upstream);
    pool.release(upstream, agent);
    for (let i = 0; i < 200; i++) {
      const a = await pool.acquire(upstream);
      pool.release(upstream, a);
    }
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 20_000; i++) {
      const a = await pool.acquire(upstream);
      pool.release(upstream, a);
    }
    const t1 = process.hrtime.bigint();
    const perOpUs = Number(t1 - t0) / 20_000 / 1000;
    console.log(`  acquire+release: ${perOpUs.toFixed(2)} µs/op`);
    expect(perOpUs).toBeLessThan(5);
    pool.destroy();
  });
});

import { LoadBalancer } from '../../src/core/load-balancer.js';

describe('LoadBalancer single-upstream fast-path', () => {
  it('returns the sole healthy upstream without timing overhead and keeps metrics', () => {
    const lb = new LoadBalancer();
    lb.setUpstreams([{ id: 'u1', protocol: 'http', host: '127.0.0.1', port: 1,
      basePath: '', poolSize: 10, timeout: 30000,
      healthCheck: { enabled: false, path: '/health', interval: 30000, timeout: 5000, expectedStatus: 200, type: 'active', gracePeriod: 5000, unhealthyThreshold: 3, healthyThreshold: 2 },
      healthy: true, circuitBreaker: 0 as never, weight: 1, activeConnections: 0 }]);
    for (let i = 0; i < 1000; i++) expect(lb.select()?.id).toBe('u1');
    const m = lb.getMetrics();
    expect(m.requestsPerUpstream.get('u1')).toBe(1000);
  });

  it('returns null when the sole upstream is unhealthy', () => {
    const lb = new LoadBalancer();
    lb.setUpstreams([{ id: 'u1', protocol: 'http', host: '127.0.0.1', port: 1,
      basePath: '', poolSize: 10, timeout: 30000,
      healthCheck: { enabled: false, path: '/health', interval: 30000, timeout: 5000, expectedStatus: 200, type: 'active', gracePeriod: 5000, unhealthyThreshold: 3, healthyThreshold: 2 },
      healthy: false, circuitBreaker: 0 as never, weight: 1, activeConnections: 0 }]);
    expect(lb.select()).toBeNull();
  });

  it('still honors multi-upstream round-robin when two upstreams exist', () => {
    const mk = (id: string) => ({ id, protocol: 'http' as const, host: '127.0.0.1', port: 1,
      basePath: '', poolSize: 10, timeout: 30000,
      healthCheck: { enabled: false, path: '/health', interval: 30000, timeout: 5000, expectedStatus: 200, type: 'active' as const, gracePeriod: 5000, unhealthyThreshold: 3, healthyThreshold: 2 },
      healthy: true, circuitBreaker: 0 as never, weight: 1, activeConnections: 0 });
    const lb = new LoadBalancer();
    lb.setUpstreams([mk('a'), mk('b')]);
    const picks = [lb.select()?.id, lb.select()?.id, lb.select()?.id];
    expect(picks).toEqual(['a', 'b', 'a']);
  });
});
