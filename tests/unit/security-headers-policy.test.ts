import { describe, it, expect } from 'vitest';
import { SecurityHeadersPolicy } from '../../src/pipeline/security-headers-policy.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function ctx() {
  const c = pool.acquire();
  c.requestId = 'req-1';
  c.method = 'GET' as never;
  c.path = '/api/x';
  c.headers = {};
  c.state = {};
  c.responded = false;
  c.res = { setHeader: () => {}, end: () => {}, statusCode: 0, headersSent: false } as never;
  return c;
}

function baseResponse() {
  return {
    statusCode: 201,
    headers: {
      'content-type': 'application/json',
      server: 'nginx/1.25.0',
      'x-powered-by': 'Express',
    },
    body: Buffer.from('{"ok":true}'),
  };
}

describe('SecurityHeadersPolicy', () => {
  it('adds default security headers', () => {
    const p = new SecurityHeadersPolicy();
    const out = p.executeOutbound(ctx(), baseResponse());
    expect(out.headers['x-content-type-options']).toBe('nosniff');
    expect(out.headers['x-frame-options']).toBe('DENY');
    expect(out.headers['referrer-policy']).toBe('no-referrer');
  });

  it('strips server and x-powered-by by default', () => {
    const p = new SecurityHeadersPolicy();
    const out = p.executeOutbound(ctx(), baseResponse());
    expect(out.headers['server']).toBeUndefined();
    expect(out.headers['x-powered-by']).toBeUndefined();
  });

  it('keeps server when stripServer is false', () => {
    const p = new SecurityHeadersPolicy({ stripServer: false });
    const out = p.executeOutbound(ctx(), baseResponse());
    expect(out.headers['server']).toBe('nginx/1.25.0');
    expect(out.headers['x-powered-by']).toBe('Express');
  });

  it('adds strict-transport-security when hsts is configured', () => {
    const p = new SecurityHeadersPolicy({ hsts: 'max-age=31536000' });
    const out = p.executeOutbound(ctx(), baseResponse());
    expect(out.headers['strict-transport-security']).toBe('max-age=31536000');
  });

  it('omits x-frame-options when frameOptions is false', () => {
    const p = new SecurityHeadersPolicy({ frameOptions: false });
    const out = p.executeOutbound(ctx(), baseResponse());
    expect(out.headers['x-frame-options']).toBeUndefined();
  });

  it('merges extra headers', () => {
    const p = new SecurityHeadersPolicy({ extra: { 'x-custom': 'yes' } });
    const out = p.executeOutbound(ctx(), baseResponse());
    expect(out.headers['x-custom']).toBe('yes');
  });

  it('preserves statusCode and body', () => {
    const p = new SecurityHeadersPolicy();
    const res = baseResponse();
    const out = p.executeOutbound(ctx(), res);
    expect(out.statusCode).toBe(201);
    expect(out.body).toBe(res.body);
  });

  it('preserves other pre-existing headers', () => {
    const p = new SecurityHeadersPolicy();
    const out = p.executeOutbound(ctx(), baseResponse());
    expect(out.headers['content-type']).toBe('application/json');
  });
});
