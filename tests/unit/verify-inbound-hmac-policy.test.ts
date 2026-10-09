import { describe, it, expect } from 'vitest';
import { createHmac, createHash } from 'node:crypto';
import { VerifyInboundHmacPolicy } from '../../src/identity/verify-inbound-hmac-policy.js';
import { ContextPool } from '../../src/core/context.js';

const SECRET = 'inbound-webhook-secret-32-characters!!';
const pool = new ContextPool(10);

function makeCtx(overrides: Record<string, unknown> = {}): any {
  const ctx = pool.acquire() as any;
  ctx.requestId = 'req-inbound';
  ctx.method = 'POST';
  ctx.path = '/webhooks/provider';
  ctx.headers = {};
  ctx.body = null;
  ctx.state = {};
  ctx.responded = false;
  ctx.req = {
    on: (_e: string, fn: Function) => {
      if (_e === 'end') fn();
      return ctx.req;
    },
    destroy: () => {},
  } as any;
  ctx.res = { setHeader: () => {}, end: () => {}, statusCode: 0, headersSent: false } as any;
  Object.assign(ctx, overrides);
  return ctx;
}

function sign(method: string, path: string, body: Buffer | null): { sig: string; ts: string } {
  const ts = Math.floor(Date.now() / 1000).toString();
  const digest = createHash('sha256')
    .update(body ?? Buffer.alloc(0))
    .digest('hex');
  const sig = createHmac('sha256', SECRET)
    .update(`${method}\n${path}\n${ts}\n${digest}`)
    .digest('base64');
  return { sig, ts };
}

const policy = (config: Record<string, unknown> = {}) =>
  new VerifyInboundHmacPolicy({ secret: SECRET, ...config });

describe('VerifyInboundHmacPolicy.executeInbound', () => {
  it('allows a request with a valid signature', async () => {
    const body = Buffer.from('{"event":"payment.succeeded"}');
    const { sig, ts } = sign('POST', '/webhooks/provider', body);
    const ctx = makeCtx({ body, headers: { 'x-signature': sig, 'x-timestamp': ts } });
    expect(await policy().executeInbound(ctx)).toBeUndefined();
  });

  it('rejects a request missing the signature header with a 401 problem', async () => {
    const ctx = makeCtx();
    const res = await policy().executeInbound(ctx);
    expect(res).toBeInstanceOf(Response);
    expect(res!.status).toBe(401);
    expect(res!.headers.get('content-type')).toBe('application/problem+json');
  });

  it('rejects a request with a wrong signature', async () => {
    const body = Buffer.from('{"event":"payment.succeeded"}');
    const { ts } = sign('POST', '/webhooks/provider', body);
    const ctx = makeCtx({
      body,
      headers: { 'x-signature': 'Zm9yZ2VkLXNpZ25hdHVyZQ==', 'x-timestamp': ts },
    });
    const res = await policy().executeInbound(ctx);
    expect(res).toBeInstanceOf(Response);
    expect(res!.status).toBe(401);
  });

  it('rejects an expired timestamp', async () => {
    const body = Buffer.from('{"event":"payment.succeeded"}');
    const expired = (Math.floor(Date.now() / 1000) - 1000).toString();
    const digest = createHash('sha256').update(body).digest('hex');
    const sig = createHmac('sha256', SECRET)
      .update(`POST\n/webhooks/provider\n${expired}\n${digest}`)
      .digest('base64');
    const ctx = makeCtx({ body, headers: { 'x-signature': sig, 'x-timestamp': expired } });
    const res = await policy().executeInbound(ctx);
    expect(res).toBeInstanceOf(Response);
    expect(res!.status).toBe(401);
  });

  it('skips public routes with no headers', async () => {
    const ctx = makeCtx({ path: '/health' });
    expect(await policy().executeInbound(ctx)).toBeUndefined();
  });

  it('allows a bodyless GET with a valid signature over the empty body', async () => {
    const { sig, ts } = sign('GET', '/webhooks/provider', null);
    const ctx = makeCtx({
      method: 'GET',
      body: null,
      headers: { 'x-signature': sig, 'x-timestamp': ts },
    });
    expect(await policy().executeInbound(ctx)).toBeUndefined();
  });
});
