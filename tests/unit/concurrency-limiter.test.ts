import { describe, it, expect } from 'vitest';
import { ConcurrencyLimiter } from '../../src/core/concurrency-limiter.js';

describe('ConcurrencyLimiter', () => {
  it('rejects above the current limit', () => {
    const l = new ConcurrencyLimiter({ min: 1, max: 2 });
    expect(l.tryAcquire()).toBe(true);
    expect(l.tryAcquire()).toBe(true);
    expect(l.tryAcquire()).toBe(false);
  });

  it('shrinks the limit under high p95 latency', () => {
    const l = new ConcurrencyLimiter({ min: 1, max: 100 });
    for (let i = 0; i < 30; i++) {
      l.tryAcquire();
      l.release(500);
    }
    expect(l.currentLimit()).toBeLessThan(100);
  });

  it('grows the limit under low latency', () => {
    const l = new ConcurrencyLimiter({ min: 1, max: 50 });
    for (let i = 0; i < 40; i++) {
      l.tryAcquire();
      l.release(5);
    }
    expect(l.currentLimit()).toBeGreaterThan(1);
  });

  it('never drops below min or above max', () => {
    const l = new ConcurrencyLimiter({ min: 3, max: 5 });
    for (let i = 0; i < 50; i++) {
      l.tryAcquire();
      l.release(9999);
    }
    expect(l.currentLimit()).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 50; i++) {
      l.tryAcquire();
      l.release(1);
    }
    expect(l.currentLimit()).toBeLessThanOrEqual(5);
  });
});
