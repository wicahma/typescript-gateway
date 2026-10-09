import { describe, it, expect } from 'vitest';
import { LoadShedPolicy } from '../../src/pipeline/load-shed-policy.js';
import { ConcurrencyLimiter } from '../../src/core/concurrency-limiter.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function ctx() {
  const c = pool.acquire();
  c.requestId = 'req-1';
  c.method = 'GET' as never;
  c.path = '/x';
  c.headers = {};
  c.state = {};
  c.responded = false;
  return c;
}

describe('LoadShedPolicy', () => {
  it('sheds with 503 once the limiter is saturated', () => {
    const policy = new LoadShedPolicy(new ConcurrencyLimiter({ min: 1, max: 1 }));
    const a = ctx();
    expect(policy.executeInbound(a)).toBeUndefined();
    const res = policy.executeInbound(ctx()) as Response;
    expect(res.status).toBe(503);
    policy.onComplete(a);
    expect(policy.executeInbound(ctx())).toBeUndefined();
  });

  it('releases via executeOutbound too, and only once', () => {
    const limiter = new ConcurrencyLimiter({ min: 1, max: 1 });
    const policy = new LoadShedPolicy(limiter);
    const a = ctx();
    policy.executeInbound(a);
    policy.executeOutbound(a, { statusCode: 200, headers: {} });
    policy.onComplete(a);
    expect(limiter.inFlight()).toBe(0);
  });
});
