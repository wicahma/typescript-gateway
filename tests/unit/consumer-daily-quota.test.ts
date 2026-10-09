import { describe, it, expect } from 'vitest';
import { ConsumerRateLimitPolicy } from '../../src/identity/consumer-rate-limit-policy.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function makeCtx(sub?: string, rateLimit = 1000, dailyLimit?: number): any {
  const ctx = pool.acquire();
  ctx.requestId = 'req-test';
  ctx.method = 'GET';
  ctx.path = '/api/data';
  ctx.headers = {};
  ctx.state = sub ? { user: { sub, data: { plan: 'pro', rateLimit, dailyLimit } } } : {};
  ctx.responded = false;
  ctx.res = {
    headers: {} as Record<string, unknown>,
    setHeader(name: string, value: unknown) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader(name: string) {
      return this.headers[name.toLowerCase()];
    },
    end: () => {},
    statusCode: 0,
    headersSent: false,
  };
  return ctx;
}

describe('ConsumerRateLimitPolicy daily quota', () => {
  it('allows requests up to the daily limit then 429', async () => {
    const policy = new ConsumerRateLimitPolicy();
    for (let i = 0; i < 3; i++) {
      expect(policy.executeInbound(makeCtx('cust-d', 1000, 3))).toBeUndefined();
    }
    const res = policy.executeInbound(makeCtx('cust-d', 1000, 3)) as Response;
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(429);
    expect(res.headers.get('x-ratelimit-daily-limit')).toBe('3');
    expect(res.headers.get('x-ratelimit-daily-remaining')).toBe('0');
  });

  it('exposes daily remaining on allowed responses', () => {
    const policy = new ConsumerRateLimitPolicy();
    const ctx = makeCtx('cust-e', 1000, 5);
    policy.executeInbound(ctx);
    expect(ctx.res.getHeader('x-ratelimit-daily-limit')).toBe('5');
    expect(ctx.res.getHeader('x-ratelimit-daily-remaining')).toBe('4');
  });

  it('skips the daily quota when dailyLimit is undefined or 0', () => {
    const policy = new ConsumerRateLimitPolicy();
    for (let i = 0; i < 5; i++) {
      const ctx = makeCtx('cust-f', 1000);
      expect(policy.executeInbound(ctx)).toBeUndefined();
      expect(ctx.res.getHeader('x-ratelimit-daily-limit')).toBeUndefined();
    }
  });

  it('tracks daily quota per consumer independently', () => {
    const policy = new ConsumerRateLimitPolicy();
    policy.executeInbound(makeCtx('a', 1000, 1));
    const aBlocked = policy.executeInbound(makeCtx('a', 1000, 1)) as Response;
    expect(aBlocked.status).toBe(429);
    expect(policy.executeInbound(makeCtx('b', 1000, 1))).toBeUndefined();
  });
});
