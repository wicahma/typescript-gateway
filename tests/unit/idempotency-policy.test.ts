import { describe, it, expect } from 'vitest';
import { IdempotencyPolicy } from '../../src/pipeline/idempotency-policy.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function ctx(headers: Record<string, string> = {}, body = Buffer.from('{}')) {
  const c = pool.acquire();
  c.requestId = 'req-1';
  c.method = 'POST' as never;
  c.path = '/api/pay';
  c.headers = headers;
  c.body = body;
  c.state = {};
  c.responded = false;
  c.res = { setHeader: () => {}, end: () => {}, statusCode: 0, headersSent: false } as never;
  return c;
}

describe('IdempotencyPolicy', () => {
  it('replays the stored response for a repeated key', async () => {
    const p = new IdempotencyPolicy();
    const c1 = ctx({ 'idempotency-key': 'k1' });
    expect(p.executeInbound(c1)).toBeUndefined();
    p.executeOutbound(c1, {
      statusCode: 201,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"id":7}'),
    });

    const c2 = ctx({ 'idempotency-key': 'k1' });
    const res = p.executeInbound(c2) as Response;
    expect(res.status).toBe(201);
    expect(await res.text()).toBe('{"id":7}');
    expect(res.headers.get('idempotent-replay')).toBe('true');
  });

  it('returns 400 when the same key is reused with a different body', () => {
    const p = new IdempotencyPolicy();
    p.executeInbound(ctx({ 'idempotency-key': 'k2' }, Buffer.from('{"a":1}')));
    const res = p.executeInbound(ctx({ 'idempotency-key': 'k2' }, Buffer.from('{"a":2}'))) as Response;
    expect(res.status).toBe(400);
  });

  it('returns 409 while the original request is still in flight', () => {
    const p = new IdempotencyPolicy();
    p.executeInbound(ctx({ 'idempotency-key': 'k3' }));
    const res = p.executeInbound(ctx({ 'idempotency-key': 'k3' })) as Response;
    expect(res.status).toBe(409);
  });

  it('ignores requests without the header', () => {
    const p = new IdempotencyPolicy();
    expect(p.executeInbound(ctx())).toBeUndefined();
  });

  it('ignores GET requests', () => {
    const p = new IdempotencyPolicy();
    const c = ctx({ 'idempotency-key': 'k4' });
    c.method = 'GET' as never;
    expect(p.executeInbound(c)).toBeUndefined();
  });
});
