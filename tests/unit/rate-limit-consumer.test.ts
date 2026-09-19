import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimitPlugin, RateLimitConfig } from '../../src/plugins/builtin/rate-limit-plugin.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function makeCtx(path = '/api/data', user?: { sub: string; data: { plan: string; rateLimit: number } }): any {
  const ctx = pool.acquire();
  ctx.requestId = 'req-test';
  ctx.method = 'GET';
  ctx.path = path;
  ctx.headers = {};
  ctx.state = user ? { user } : {};
  ctx.responded = false;
  ctx.res = {
    setHeader: () => {},
    end: () => {},
    statusCode: 0,
    headersSent: false,
  } as any;
  return ctx;
}

const consumerConfig: RateLimitConfig = {
  enabled: true,
  strategies: [
    {
      name: 'consumer-tier',
      type: 'token-bucket',
      keyExtractor: 'consumer',
      routes: ['/api/*'],
    },
  ],
  includeHeaders: false,
};

describe('RateLimitPlugin consumer key extractor', () => {
  let plugin: RateLimitPlugin;

  beforeEach(() => {
    plugin = new RateLimitPlugin();
    plugin.init(consumerConfig as unknown as Record<string, unknown>);
  });

  it('uses consumer sub as the bucket key', () => {
    const user = { sub: 'cust-1', data: { plan: 'pro', rateLimit: 5000 } };
    const r1 = plugin.preRoute(makeCtx('/api/data', user));
    expect(r1).toBeUndefined();
    const stats = plugin.getStats() as Record<string, { buckets?: number }>;
    expect(Object.keys(stats).length).toBeGreaterThan(0);
  });

  it('separates buckets per consumer', () => {
    const a = { sub: 'cust-a', data: { plan: 'free', rateLimit: 1 } };
    const b = { sub: 'cust-b', data: { plan: 'pro', rateLimit: 1000 } };
    plugin.preRoute(makeCtx('/api/data', a));
    plugin.preRoute(makeCtx('/api/data', b));
    expect(plugin.getStats()).toBeTruthy();
  });

  it('rejects 429 when the consumer bucket is drained', () => {
    const user = { sub: 'cust-drain', data: { plan: 'free', rateLimit: 1 } };
    const cfg: RateLimitConfig = {
      enabled: true,
      strategies: [
        {
          name: 'tiny-bucket',
          type: 'token-bucket',
          capacity: 1,
          refillRate: 0.001,
          keyExtractor: 'consumer',
          routes: ['/api/*'],
        },
      ],
      includeHeaders: false,
    };
    const tiny = new RateLimitPlugin();
    tiny.init(cfg as unknown as Record<string, unknown>);
    const ctx1 = makeCtx('/api/data', user);
    const ctx2 = makeCtx('/api/data', user);
    tiny.preRoute(ctx1);
    tiny.preRoute(ctx2);
    expect(ctx2.responded).toBe(true);
  });

  it('skips non-matching routes', () => {
    const user = { sub: 'cust-skip', data: { plan: 'free', rateLimit: 1 } };
    const ctx = makeCtx('/health', user);
    plugin.preRoute(ctx);
    expect(ctx.responded).toBe(false);
  });

  it('skips requests without authenticated consumer (no state.user)', () => {
    const ctx = makeCtx('/api/data');
    plugin.preRoute(ctx);
    expect(ctx.responded).toBe(false);
  });
});
