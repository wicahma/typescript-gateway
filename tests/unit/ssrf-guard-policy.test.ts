import { describe, it, expect } from 'vitest';
import { SsrfGuardPolicy } from '../../src/pipeline/ssrf-guard-policy.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function ctx(params: Record<string, string> = {}) {
  const c = pool.acquire();
  c.requestId = 'req-1';
  c.method = 'GET';
  c.path = '/api/x';
  c.params = params;
  c.headers = {};
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

describe('SsrfGuardPolicy', () => {
  it('allows a public hostname', () => {
    const p = new SsrfGuardPolicy();
    expect(p.executeInbound(ctx({ host: 'api.example.com' }))).toBeUndefined();
  });

  it('blocks loopback 127.0.0.1', () => {
    const p = new SsrfGuardPolicy();
    const res = p.executeInbound(ctx({ host: '127.0.0.1' })) as Response;
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('blocks private 10.0.0.5', () => {
    const p = new SsrfGuardPolicy();
    expect((p.executeInbound(ctx({ host: '10.0.0.5' })) as Response).status).toBe(403);
  });

  it('blocks cloud metadata 169.254.169.254', () => {
    const p = new SsrfGuardPolicy();
    expect((p.executeInbound(ctx({ host: '169.254.169.254' })) as Response).status).toBe(403);
  });

  it('blocks localhost', () => {
    const p = new SsrfGuardPolicy();
    expect((p.executeInbound(ctx({ host: 'localhost' })) as Response).status).toBe(403);
  });

  it('allows an allowlisted private host', () => {
    const p = new SsrfGuardPolicy({ allowlist: ['127.0.0.1'] });
    expect(p.executeInbound(ctx({ host: '127.0.0.1' }))).toBeUndefined();
  });

  it('allows everything when allowPrivate is true', () => {
    const p = new SsrfGuardPolicy({ allowPrivate: true });
    expect(p.executeInbound(ctx({ host: '10.0.0.1' }))).toBeUndefined();
  });

  it('allows when no host target is present', () => {
    const p = new SsrfGuardPolicy();
    expect(p.executeInbound(ctx())).toBeUndefined();
  });
});
