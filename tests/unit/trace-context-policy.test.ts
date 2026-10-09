import { describe, it, expect } from 'vitest';
import { TraceContextPolicy } from '../../src/pipeline/trace-context-policy.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function ctx(headers: Record<string, string> = {}) {
  const c = pool.acquire();
  c.requestId = 'req-1';
  c.method = 'GET' as never;
  c.path = '/api/x';
  c.headers = headers;
  c.state = {};
  c.responded = false;
  c.res = {
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
  } as never;
  return c;
}

const VALID = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

describe('TraceContextPolicy', () => {
  it('continues a valid incoming traceparent', () => {
    const p = new TraceContextPolicy();
    const c = ctx({ traceparent: VALID });
    p.executeInbound(c);
    const out = c.res.getHeader('traceparent') as string;
    expect(out.startsWith('00-4bf92f3577b34da6a3ce929d0e0e4736-')).toBe(true);
    expect(c.state['traceId']).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('generates a new trace when absent', () => {
    const p = new TraceContextPolicy();
    const c = ctx();
    p.executeInbound(c);
    expect(c.res.getHeader('traceparent') as string).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('ignores a malformed traceparent', () => {
    const p = new TraceContextPolicy();
    const c = ctx({ traceparent: 'garbage' });
    p.executeInbound(c);
    expect(c.res.getHeader('traceparent') as string).toMatch(/^00-[0-9a-f]{32}-/);
  });
});
