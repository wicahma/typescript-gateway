import { describe, it, expect } from 'vitest';
import { ShadowPolicy } from '../../src/pipeline/shadow-policy.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function ctx(path = '/api/x', method = 'GET', headers: Record<string, string> = {}) {
  const c = pool.acquire();
  c.requestId = 'req-1';
  c.method = method as never;
  c.path = path;
  c.headers = headers;
  c.body = null;
  c.state = {};
  c.responded = false;
  c.res = {} as never;
  return c;
}

function recordingFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return { calls, impl };
}

describe('ShadowPolicy', () => {
  it('samples and mirrors the request when sampleRate is 1.0', async () => {
    const { calls, impl } = recordingFetch();
    const p = new ShadowPolicy({
      target: 'http://127.0.0.1:9999',
      sampleRate: 1,
      fetchImpl: impl,
    });
    p.executeInbound(ctx('/api/x'));
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe('http://127.0.0.1:9999/api/x');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['x-shadow']).toBe('true');
  });

  it('does not mirror when sampleRate is 0.0', () => {
    const { calls, impl } = recordingFetch();
    const p = new ShadowPolicy({ target: 'http://127.0.0.1:9999', sampleRate: 0, fetchImpl: impl });
    p.executeInbound(ctx('/api/x'));
    expect(calls.length).toBe(0);
  });

  it('does not mirror a method not in methods', () => {
    const { calls, impl } = recordingFetch();
    const p = new ShadowPolicy({
      target: 'http://127.0.0.1:9999',
      sampleRate: 1,
      methods: ['GET'],
      fetchImpl: impl,
    });
    p.executeInbound(ctx('/api/x', 'OPTIONS'));
    expect(calls.length).toBe(0);
  });

  it('never throws on rejection and returns inflight to 0', async () => {
    const impl = (async () => {
      throw new Error('upstream down');
    }) as typeof fetch;
    const p = new ShadowPolicy({ target: 'http://127.0.0.1:9999', sampleRate: 1, fetchImpl: impl });
    expect(() => p.executeInbound(ctx('/api/x'))).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(p.inflight()).toBe(0);
  });

  it('skips mirroring when maxInflight is reached', () => {
    let callCount = 0;
    const impl = (() => {
      callCount++;
      return new Promise<Response>(() => {});
    }) as typeof fetch;
    const p = new ShadowPolicy({
      target: 'http://127.0.0.1:9999',
      sampleRate: 1,
      maxInflight: 1,
      fetchImpl: impl,
    });
    p.executeInbound(ctx('/api/x'));
    p.executeInbound(ctx('/api/y'));
    expect(callCount).toBe(1);
    expect(p.inflight()).toBe(1);
  });
});
