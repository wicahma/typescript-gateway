import { describe, it, expect } from 'vitest';
import { RequestPipeline } from '../../src/pipeline/request-pipeline.js';
import { GatewayPolicy } from '../../src/pipeline/policy.js';
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

describe('RequestPipeline onComplete', () => {
  it('calls onComplete for every policy after a short-circuiting inbound', async () => {
    const calls: string[] = [];
    const a: GatewayPolicy = {
      name: 'a',
      executeInbound: () => {
        calls.push('a-in');
      },
      onComplete: () => {
        calls.push('a-done');
      },
    };
    const b: GatewayPolicy = {
      name: 'b',
      executeInbound: () => new Response('x', { status: 503 }),
      onComplete: () => {
        calls.push('b-done');
      },
    };
    const pipeline = new RequestPipeline([a, b]);
    const res = await pipeline.runInbound(ctx());
    pipeline.complete(ctx());
    expect(res).toBeInstanceOf(Response);
    expect(calls).toEqual(['a-in', 'a-done', 'b-done']);
  });

  it('swallows errors thrown by an onComplete hook', () => {
    const pipeline = new RequestPipeline([
      {
        name: 'boom',
        onComplete: () => {
          throw new Error('nope');
        },
      },
    ]);
    expect(() => pipeline.complete(ctx())).not.toThrow();
  });
});
