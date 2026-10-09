import { describe, it, expect } from 'vitest';
import { CorsPolicy } from '../../src/pipeline/cors-policy.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function ctx(headers: Record<string, string> = {}, method = 'GET') {
  const c = pool.acquire();
  c.requestId = 'req-1';
  c.method = method as never;
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

describe('CorsPolicy', () => {
  it('answers preflight with 204 and allow headers', async () => {
    const p = new CorsPolicy({
      allowOrigins: ['https://app.example.com'],
      allowMethods: ['GET', 'POST'],
    });
    const res = p.executeInbound(
      ctx({ origin: 'https://app.example.com', 'access-control-request-method': 'POST' }, 'OPTIONS')
    );
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(204);
    expect((res as Response).headers.get('access-control-allow-origin')).toBe(
      'https://app.example.com'
    );
    expect((res as Response).headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('adds allow-origin on simple requests', () => {
    const p = new CorsPolicy({ allowOrigins: ['*'] });
    const c = ctx({ origin: 'https://x.dev' });
    const res = p.executeInbound(c);
    expect(res).toBeUndefined();
    expect(c.res.getHeader('access-control-allow-origin')).toBe('*');
  });

  it('rejects a disallowed origin preflight with 403 problem+json', () => {
    const p = new CorsPolicy({ allowOrigins: ['https://app.example.com'] });
    const res = p.executeInbound(
      ctx({ origin: 'https://evil.example', 'access-control-request-method': 'POST' }, 'OPTIONS')
    );
    expect((res as Response).status).toBe(403);
    expect((res as Response).headers.get('content-type')).toBe('application/problem+json');
  });

  it('does nothing when there is no Origin header', () => {
    const p = new CorsPolicy({ allowOrigins: ['*'] });
    const c = ctx();
    expect(p.executeInbound(c)).toBeUndefined();
    expect(c.res.getHeader('access-control-allow-origin')).toBeUndefined();
  });
});
