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

  it('serves stale entry with x-cache STALE and triggers single-flight revalidation', async () => {
    const revalidateCalls: string[] = [];
    const policy = new ResponseCachePolicy(cache, {
      onStaleRevalidate: (key) => { revalidateCalls.push(key); },
    });

    // Seed cache with entry already expired but inside SWR window
    const key = cache.generateKey('GET', '/data', {});
    cache.set(key, {
      statusCode: 200,
      headers: { 'content-type': 'text/plain' },
      body: Buffer.from('stale-body'),
      cachedAt: Date.now() - 5000, // 5s old, ttl expired
      ttl: 0,
      staleWhileRevalidate: 60,
      size: 10,
    });

    const staleHit = await policy.executeInbound?.(makeCtx());
    expect(staleHit).toBeInstanceOf(Response);
    expect(staleHit!.headers.get('x-cache')).toBe('STALE');
    expect(await staleHit!.text()).toBe('stale-body');

    // Callback fires once (single-flight) even across concurrent stale hits
    await new Promise((r) => setImmediate(r));
    await policy.executeInbound?.(makeCtx());
    await policy.executeInbound?.(makeCtx());
    await new Promise((r) => setImmediate(r));
    expect(revalidateCalls.length).toBe(1);
  });

  it('does not mark fresh hits as STALE', async () => {
    const policy = new ResponseCachePolicy(cache);
    const resp = out(200, 'fresh-body');
    resp.headers['cache-control'] = 'max-age=60, stale-while-revalidate=60';
    await policy.executeOutbound?.(makeCtx(), resp);
    const hit = await policy.executeInbound?.(makeCtx());
    expect(hit!.headers.get('x-cache')).toBe('HIT');
  });

  it('keys cached responses per Vary header value', async () => {
    const policy = new ResponseCachePolicy(cache);

    const gzipReq = makeCtx();
    gzipReq.headers = { 'accept-encoding': 'gzip' };
    const gzipResp = out(200, 'gzip-body');
    gzipResp.headers['vary'] = 'Accept-Encoding';
    await policy.executeOutbound?.(gzipReq, gzipResp);

    const brReq = makeCtx();
    brReq.headers = { 'accept-encoding': 'br' };
    const brResp = out(200, 'br-body');
    brResp.headers['vary'] = 'Accept-Encoding';
    await policy.executeOutbound?.(brReq, brResp);

    // Same path, different Accept-Encoding → distinct cache entries
    const gzipHit = await policy.executeInbound?.((() => { const c = makeCtx(); c.headers = { 'accept-encoding': 'gzip' }; return c; })());
    expect(await gzipHit!.text()).toBe('gzip-body');

    const brHit = await policy.executeInbound?.((() => { const c = makeCtx(); c.headers = { 'accept-encoding': 'br' }; return c; })());
    expect(await brHit!.text()).toBe('br-body');

    // A request with an unseen encoding misses (must not serve gzip/br bytes)
    const other = makeCtx();
    other.headers = { 'accept-encoding': 'identity' };
    expect(await policy.executeInbound?.(other)).toBeUndefined();
  });

  it('exposes validators (If-None-Match) for conditional revalidation and refresh() restarts freshness', async () => {
    const policy = new ResponseCachePolicy(cache);
    const ctx = makeCtx();
    const resp = out(200, 'cached-with-etag');
    resp.headers['etag'] = '"abc123"';
    resp.headers['cache-control'] = 'max-age=60';
    await policy.executeOutbound?.(ctx, resp);

    const key = cache.generateKey('GET', '/data', {});
    const validators = policy.validatorsFor(key);
    expect(validators['if-none-match']).toBe('"abc123"');

    // Force stale, then refresh via 304-style headers
    const entry = cache.lookup(key).response!;
    entry.cachedAt = Date.now() - 120_000;
    entry.ttl = 1;
    entry.staleWhileRevalidate = 600;
    expect(cache.lookup(key).state).toBe('stale');

    const refreshed = cache.refresh(key, { etag: '"def456"' });
    expect(refreshed).toBe(true);
    expect(cache.lookup(key).state).toBe('fresh');
    expect(cache.lookup(key).response!.etag).toBe('"def456"');
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
