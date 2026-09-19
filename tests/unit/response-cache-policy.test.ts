import { describe, it, expect, beforeEach } from 'vitest';
import { ResponseCachePolicy } from '../../src/core/response-cache-policy.js';
import { ResponseCache } from '../../src/core/response-cache.js';
import { RequestPipeline } from '../../src/pipeline/request-pipeline.js';
import { OutboundResponse } from '../../src/pipeline/policy.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function makeCtx(method = 'GET', path = '/data'): any {
  const ctx = pool.acquire();
  ctx.method = method as any;
  ctx.path = path;
  ctx.headers = {};
  ctx.state = {};
  ctx.responded = false;
  return ctx;
}

function out(statusCode = 200, body = 'hello'): OutboundResponse {
  return { statusCode, headers: { 'content-type': 'text/plain' }, body: Buffer.from(body) };
}

describe('ResponseCachePolicy', () => {
  let cache: ResponseCache;

  beforeEach(() => {
    cache = new ResponseCache({ maxSize: 1024 * 1024, maxEntries: 10, defaultTTL: 60 });
  });

  it('misses on first GET and stores response', async () => {
    const policy = new ResponseCachePolicy(cache);
    const ctx = makeCtx();
    const shortCircuit = await policy.executeInbound?.(ctx);
    expect(shortCircuit).toBeUndefined();
    const result = await policy.executeOutbound?.(ctx, out());
    expect(result?.headers['x-cache']).toBe('MISS');
  });

  it('short-circuits the second identical GET with x-cache HIT', async () => {
    const policy = new ResponseCachePolicy(cache);
    const ctx = makeCtx();
    await policy.executeOutbound?.(ctx, out(200, 'cached-body'));
    const hit = await policy.executeInbound?.(makeCtx());
    expect(hit).toBeInstanceOf(Response);
    expect(hit!.status).toBe(200);
    expect(hit!.headers.get('x-cache')).toBe('HIT');
    expect(await hit!.text()).toBe('cached-body');
  });

  it('does not cache POST', async () => {
    const policy = new ResponseCachePolicy(cache);
    const post = makeCtx('POST', '/submit');
    await policy.executeOutbound?.(post, out());
    expect(await policy.executeInbound?.(makeCtx('POST', '/submit'))).toBeUndefined();
    expect(await policy.executeInbound?.(makeCtx('GET', '/submit'))).toBeUndefined();
  });

  it('does not cache non-2xx responses', async () => {
    const policy = new ResponseCachePolicy(cache);
    await policy.executeOutbound?.(makeCtx(), out(404, 'nope'));
    expect(await policy.executeInbound?.(makeCtx())).toBeUndefined();
  });

  it('does not cache no-store responses', async () => {
    const policy = new ResponseCachePolicy(cache);
    const resp = out(200, 'sensitive');
    resp.headers['cache-control'] = 'no-store';
    await policy.executeOutbound?.(makeCtx(), resp);
    expect(await policy.executeInbound?.(makeCtx())).toBeUndefined();
  });

  it('integrates with RequestPipeline: HIT short-circuits before outbound policies run', async () => {
    let outboundRuns = 0;
    const counter = {
      name: 'counter',
      executeOutbound: () => {
        outboundRuns++;
      },
    };
    const cachePolicy = new ResponseCachePolicy(cache);
    const pipeline = new RequestPipeline([counter, cachePolicy]);
    const first = makeCtx();
    await pipeline.runInbound(first);
    await pipeline.runOutbound(first, out(200, 'pipelined'));
    expect(outboundRuns).toBe(1);

    const second = makeCtx();
    const hit = await pipeline.runInbound(second);
    expect(hit).toBeInstanceOf(Response);
    expect(hit!.headers.get('x-cache')).toBe('HIT');
    expect(await hit!.text()).toBe('pipelined');
  });
});
