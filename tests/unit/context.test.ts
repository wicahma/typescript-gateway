import { describe, it, expect, beforeEach } from 'vitest';
import { ContextPool, PoolableRequestContext } from '../../src/core/context';

describe('ContextPool', () => {
  let pool: ContextPool;

  beforeEach(() => {
    pool = new ContextPool(10); // Small pool for testing
  });

  it('should create pool with initial size', () => {
    const metrics = pool.metrics();
    expect(metrics.size).toBe(10);
    expect(metrics.available).toBe(10);
    expect(metrics.inUse).toBe(0);
  });

  it('should acquire context from pool', () => {
    const ctx = pool.acquire();
    expect(ctx).toBeInstanceOf(PoolableRequestContext);

    const metrics = pool.metrics();
    expect(metrics.available).toBe(9);
    expect(metrics.inUse).toBe(1);
    expect(metrics.hits).toBe(1);
    expect(metrics.misses).toBe(0);
  });

  it('should release context back to pool', () => {
    const ctx = pool.acquire();
    pool.release(ctx);

    const metrics = pool.metrics();
    expect(metrics.available).toBe(10);
    expect(metrics.inUse).toBe(0);
  });

  it('should reset context when released', () => {
    const ctx = pool.acquire();
    ctx.requestId = 'test-123';
    ctx.method = 'POST';
    ctx.path = '/test';
    ctx.state = { key: 'value' };

    pool.release(ctx);

    // Acquire again and verify it was reset
    const ctx2 = pool.acquire();
    expect(ctx2.requestId).toBe('');
    expect(ctx2.method).toBe('GET');
    expect(ctx2.path).toBe('');
    expect(ctx2.state).toEqual({});
  });

  it('should create new context when pool is exhausted', () => {
    const contexts = [];
    // Acquire all from pool
    for (let i = 0; i < 10; i++) {
      contexts.push(pool.acquire());
    }

    // This should create a new one (miss)
    const extraCtx = pool.acquire();
    expect(extraCtx).toBeInstanceOf(PoolableRequestContext);

    const metrics = pool.metrics();
    expect(metrics.available).toBe(0);
    expect(metrics.inUse).toBe(11);
    expect(metrics.hits).toBe(10);
    expect(metrics.misses).toBe(1);
  });

  it('should track hit rate correctly', () => {
    // All hits
    for (let i = 0; i < 5; i++) {
      const ctx = pool.acquire();
      pool.release(ctx);
    }
    expect(pool.getHitRate()).toBe(100);

    // Exhaust pool and create misses
    const contexts = [];
    for (let i = 0; i < 12; i++) {
      contexts.push(pool.acquire());
    }
    // First 5 hits were 100%, then acquired 10 from pool + 2 misses
    // Total: 15 hits + 2 misses = 15/17 = 88.24%
    const hitRate = pool.getHitRate();
    expect(hitRate).toBeGreaterThan(80);
    expect(hitRate).toBeLessThan(95);
  });

  it('should not return context to pool if already at max size', () => {
    const contexts = [];
    // Acquire and create extra contexts beyond pool size
    for (let i = 0; i < 15; i++) {
      contexts.push(pool.acquire());
    }

    // Release all
    contexts.forEach(ctx => pool.release(ctx));

    // Pool should not exceed max size
    const metrics = pool.metrics();
    expect(metrics.available).toBe(10);
    expect(metrics.inUse).toBe(0);
  });

  it('should handle setRoute correctly', () => {
    const ctx = pool.acquire();
    const mockRoute = {
      handler: async () => {},
      params: { id: '123' },
      route: {
        method: 'GET',
        path: '/test/:id',
        handler: async () => {},
        priority: 0,
      },
    };

    ctx.setRoute(mockRoute);
    expect(ctx.route).toBe(mockRoute);
    expect(ctx.params).toEqual({ id: '123' });
    expect(ctx.timestamps.routeMatch).toBeGreaterThan(0);
  });

  it('should handle setState and getState correctly', () => {
    const ctx = pool.acquire();
    ctx.setState('user', { id: 1, name: 'Test' });
    ctx.setState('session', 'abc123');

    expect(ctx.getState('user')).toEqual({ id: 1, name: 'Test' });
    expect(ctx.getState('session')).toBe('abc123');
    expect(ctx.getState('nonexistent')).toBeUndefined();
  });

  it('should handle multiple acquire/release cycles', () => {
    for (let i = 0; i < 100; i++) {
      const ctx = pool.acquire();
      ctx.requestId = `req-${i}`;
      pool.release(ctx);
    }

    const metrics = pool.metrics();
    expect(metrics.available).toBe(10);
    expect(metrics.inUse).toBe(0);
    expect(metrics.totalAcquired).toBe(100);
    expect(pool.getHitRate()).toBe(100); // All should be hits after first 10
  });

  it('should ignore releasing context not from pool', () => {
    const ctx = new PoolableRequestContext();
    pool.release(ctx); // Should not error

    const metrics = pool.metrics();
    expect(metrics.available).toBe(10); // Should remain unchanged
  });

  it('should ignore double release', () => {
    const ctx = pool.acquire();
    pool.release(ctx);
    pool.release(ctx); // Should not error

    const metrics = pool.metrics();
    expect(metrics.available).toBe(10);
  });
});
