import { describe, it, expect } from 'vitest';
import { ConsumerRateLimitPolicy } from '../../src/identity/consumer-rate-limit-policy.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function makeCtx(sub?: string, rateLimit = 3): any {
  const ctx = pool.acquire();
  ctx.requestId = 'req-test';
  ctx.method = 'GET';
  ctx.path = '/api/data';
  ctx.headers = {};
  ctx.state = sub ? { user: { sub, data: { plan: 'pro', rateLimit } } } : {};
  ctx.responded = false;
  ctx.res = { setHeader: () => {}, end: () => {}, statusCode: 0, headersSent: false } as any;
  return ctx;
}

describe('ConsumerRateLimitPolicy', () => {
  it('allows up to the consumer rate limit then 429 with Retry-After', async () => {
    const policy = new ConsumerRateLimitPolicy();
    for (let i = 0; i < 3; i++) {
      const res = await policy.executeInbound?.(makeCtx('cust-a', 3));
      expect(res).toBeUndefined();
    }
    const res = await policy.executeInbound?.(makeCtx('cust-a', 3));
    expect(res).toBeInstanceOf(Response);
    expect(res!.status).toBe(429);
    expect(Number(res!.headers.get('retry-after'))).toBeGreaterThanOrEqual(0);
    expect(res!.headers.get('x-ratelimit-limit')).toBe('3');
    expect(res!.headers.get('x-ratelimit-remaining')).toBe('0');
  });

  it('uses each consumer plan rateLimit independently', async () => {
    const policy = new ConsumerRateLimitPolicy();
    const pro = await policy.executeInbound?.(makeCtx('pro-1', 1000));
    expect(pro).toBeUndefined();
    const free = await policy.executeInbound?.(makeCtx('free-1', 1));
    expect(free).toBeUndefined();
    const freeDrained = await policy.executeInbound?.(makeCtx('free-1', 1));
    expect(freeDrained).toBeInstanceOf(Response);
  });

  it('passes through requests without authenticated consumer', async () => {
    const policy = new ConsumerRateLimitPolicy();
    const res = await policy.executeInbound?.(makeCtx());
    expect(res).toBeUndefined();
  });

  it('buckets are per consumer, not global', async () => {
    const policy = new ConsumerRateLimitPolicy();
    await policy.executeInbound?.(makeCtx('c1', 1));
    const res = await policy.executeInbound?.(makeCtx('c2', 1));
    expect(res).toBeUndefined();
  });
});
