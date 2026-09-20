import { describe, it, expect } from 'vitest';
import { createHmac, createHash } from 'node:crypto';
import { HmacSignPolicy, verifyHmacSignature } from '../../src/identity/hmac-sign-policy.js';
import { UpstreamCredentialStore } from '../../src/identity/upstream-credential-store.js';
import { ContextPool } from '../../src/core/context.js';

const SECRET = 'test-secret-at-least-32-chars-long-sum!!';
const pool = new ContextPool(10);

const store = new UpstreamCredentialStore([
  { name: 'billing', headers: {}, hmac: { secret: SECRET, keyId: 'billing-key-1' } },
  { name: 'static-only', headers: {} },
]);

function makeCtx(overrides: Record<string, unknown> = {}): any {
  const ctx = pool.acquire() as any;
  ctx.requestId = 'req-hmac';
  ctx.method = 'POST';
  ctx.path = '/api/billing/charge';
  ctx.headers = {};
  ctx.body = null;
  ctx.state = {};
  ctx.responded = false;
  ctx.req = {
    on: (_e: string, fn: Function) => { if (_e === 'end') fn(); return ctx.req; },
    destroy: () => {},
  } as any;
  ctx.res = { setHeader: () => {}, end: () => {}, statusCode: 0, headersSent: false } as any;
  Object.assign(ctx, overrides);
  return ctx;
}

const authed = () => ({ state: { user: { sub: 'cust-1' } } });

const policy = () => new HmacSignPolicy(store, { credentialName: 'billing' });

function canonical(method: string, path: string, timestamp: string, body: Buffer | null): string {
  const digest = createHash('sha256').update(body ?? Buffer.alloc(0)).digest('hex');
  return `${method}\n${path}\n${timestamp}\n${digest}`;
}

describe('HmacSignPolicy.executeInbound', () => {
  it('rejects unauthenticated callers with a 401 problem', async () => {
    const res = await policy().executeInbound(makeCtx());
    expect(res).toBeInstanceOf(Response);
    expect(res!.status).toBe(401);
    expect(res!.headers.get('content-type')).toBe('application/problem+json');
  });

  it('signs an authenticated request with base64 signature, numeric timestamp and key id', async () => {
    const ctx = makeCtx({ ...authed(), body: Buffer.from('{"amount":42}') });
    expect(await policy().executeInbound(ctx)).toBeUndefined();
    expect(ctx.headers['x-signature']).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(ctx.headers['x-timestamp']).toMatch(/^\d+$/);
    expect(ctx.headers['x-key-id']).toBe('billing-key-1');
  });

  it('produces a signature that round-trips via verifyHmacSignature with the same inputs', async () => {
    const body = Buffer.from('{"amount":99,"currency":"IDR"}');
    const ctx = makeCtx({ ...authed(), body });
    await policy().executeInbound(ctx);
    expect(
      verifyHmacSignature(
        SECRET,
        ctx.method,
        ctx.path,
        ctx.headers['x-timestamp'] as string,
        body,
        ctx.headers['x-signature'] as string,
      ),
    ).toBe(true);
  });

  it('fails verification when the body was tampered with', async () => {
    const ctx = makeCtx({ ...authed(), body: Buffer.from('{"amount":1}') });
    await policy().executeInbound(ctx);
    expect(
      verifyHmacSignature(
        SECRET,
        'POST',
        ctx.path,
        ctx.headers['x-timestamp'] as string,
        Buffer.from('{"amount":1000000}'),
        ctx.headers['x-signature'] as string,
      ),
    ).toBe(false);
  });

  it('rejects timestamps older than the replay window and accepts fresh ones', () => {
    const old = String(Math.floor(Date.now() / 1000) - 400);
    const oldSig = createHmac('sha256', SECRET).update(canonical('GET', '/api/x', old, null)).digest('base64');
    expect(verifyHmacSignature(SECRET, 'GET', '/api/x', old, null, oldSig)).toBe(false);
    const fresh = String(Math.floor(Date.now() / 1000));
    const freshSig = createHmac('sha256', SECRET).update(canonical('GET', '/api/x', fresh, null)).digest('base64');
    expect(verifyHmacSignature(SECRET, 'GET', '/api/x', fresh, null, freshSig)).toBe(true);
  });

  it('signs a null body as sha256 of the empty string', async () => {
    const ctx = makeCtx({ ...authed(), method: 'GET' });
    await policy().executeInbound(ctx);
    const timestamp = ctx.headers['x-timestamp'] as string;
    const expected = createHmac('sha256', SECRET)
      .update(canonical('GET', ctx.path, timestamp, null))
      .digest('base64');
    expect(ctx.headers['x-signature']).toBe(expected);
  });

  it('returns a 500 problem for a credential without an hmac block', async () => {
    const p = new HmacSignPolicy(store, { credentialName: 'static-only' });
    const res = await p.executeInbound(makeCtx(authed()));
    expect(res!.status).toBe(500);
  });

  it('returns a 500 problem for an unknown credential name', async () => {
    const p = new HmacSignPolicy(store, { credentialName: 'ghost' });
    const res = await p.executeInbound(makeCtx(authed()));
    expect(res!.status).toBe(500);
  });

  it('bypasses public routes by default and via custom publicRoutes', async () => {
    const bypassed = makeCtx({ path: '/health' });
    expect(await policy().executeInbound(bypassed)).toBeUndefined();
    expect(bypassed.headers['x-signature']).toBeUndefined();
    const custom = new HmacSignPolicy(store, { credentialName: 'billing', publicRoutes: ['/status'] });
    expect(await custom.executeInbound(makeCtx({ path: '/status' }))).toBeUndefined();
  });

  it('adds only signature headers without clobbering caller headers', async () => {
    const ctx = makeCtx({ ...authed(), body: Buffer.alloc(0), headers: { 'x-tenant': 'acme', authorization: 'Bearer tok' } });
    await policy().executeInbound(ctx);
    expect(ctx.headers['x-tenant']).toBe('acme');
    expect(ctx.headers['authorization']).toBe('Bearer tok');
    expect(Object.keys(ctx.headers).sort()).toEqual([
      'authorization',
      'x-key-id',
      'x-signature',
      'x-tenant',
      'x-timestamp',
    ]);
  });

  it('uses the credential header namespace for signature headers when provided', async () => {
    const nsStore = new UpstreamCredentialStore([
      {
        name: 'ledger',
        headers: {},
        hmac: { secret: SECRET, keyId: 'l1', headerNamespace: 'x-ledger-auth' },
      },
    ]);
    const ctx = makeCtx({ ...authed(), body: Buffer.alloc(0) });
    await new HmacSignPolicy(nsStore, { credentialName: 'ledger' }).executeInbound(ctx);
    expect(ctx.headers['x-ledger-auth-signature']).toBeDefined();
    expect(ctx.headers['x-ledger-auth-timestamp']).toBeDefined();
    expect(ctx.headers['x-signature']).toBeUndefined();
    expect(ctx.headers['x-ledger-auth-signature']).not.toContain(SECRET);
  });
});

describe('HmacSignPolicy performance', () => {
  it('signs a 64KB body in under 5ms', async () => {
    const p = policy();
    const body = Buffer.alloc(64 * 1024, 0x61);
    await p.executeInbound(makeCtx({ ...authed(), body }));
    const start = process.hrtime.bigint();
    await p.executeInbound(makeCtx({ ...authed(), body }));
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    expect(elapsedMs).toBeLessThan(5);
  });
});
