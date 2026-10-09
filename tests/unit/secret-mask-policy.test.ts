import { describe, it, expect } from 'vitest';
import { SecretMaskPolicy } from '../../src/pipeline/secret-mask-policy.js';
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

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwx';

describe('SecretMaskPolicy', () => {
  it('masks a JWT in a JSON body', () => {
    const p = new SecretMaskPolicy();
    const body = Buffer.from(JSON.stringify({ token: JWT }));
    const out = p.executeOutbound(ctx(), {
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'content-length': String(body.length) },
      body,
    })!;
    expect(out.body!.toString()).toContain('[REDACTED]');
    expect(out.body!.toString()).not.toContain(JWT);
    expect(out.headers['content-length']).toBe(String(out.body!.length));
    expect(out.headers['x-secret-masked']).toBe('true');
  });

  it('leaves non-text responses untouched', () => {
    const p = new SecretMaskPolicy();
    const body = Buffer.from([0, 1, 2, 3]);
    const out = p.executeOutbound(ctx(), {
      statusCode: 200,
      headers: { 'content-type': 'image/png' },
      body,
    });
    expect(out).toBeUndefined();
  });

  it('returns void when no pattern matches', () => {
    const p = new SecretMaskPolicy();
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const out = p.executeOutbound(ctx(), {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(out).toBeUndefined();
  });
});
