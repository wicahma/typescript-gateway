import { describe, it, expect } from 'vitest';
import { SetUpStreamHeaderPolicy } from '../../src/identity/set-upstream-header-policy.js';
import { UpstreamCredentialStore } from '../../src/identity/upstream-credential-store.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function makeCtx(path = '/data'): any {
  const ctx = pool.acquire();
  ctx.method = 'GET';
  ctx.path = path;
  ctx.headers = {};
  ctx.state = {};
  ctx.responded = false;
  return ctx;
}

function makePolicy(credentialName = 'payment-service', path = '/data') {
  const store = new UpstreamCredentialStore([
    {
      name: 'payment-service',
      headers: { authorization: 'Bearer internal-secret-123', 'x-internal-service': 'gateway' },
    },
  ]);
  const policy = new SetUpStreamHeaderPolicy(store, { credentialName });
  return { store, policy };
}

function makeCtxWith(path: string, headers: Record<string, string>, user?: unknown): any {
  const ctx = makeCtx(path);
  ctx.headers = { ...headers };
  if (user !== undefined) ctx.state['user'] = user;
  return ctx;
}

describe('SetUpStreamHeaderPolicy', () => {
  it('returns 401 problem+json when caller is not authenticated', () => {
    const { policy } = makePolicy();
    const ctx = makeCtx();
    const res = policy.executeInbound(ctx) as Response;
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(ctx.headers).toEqual({});
  });

  it('injects internal credential headers on authenticated request', () => {
    const { policy } = makePolicy();
    const ctx = makeCtxWith('/data', {}, { sub: 'consumer-1', data: {} });
    expect(policy.executeInbound(ctx)).toBeUndefined();
    expect(ctx.headers['authorization']).toBe('Bearer internal-secret-123');
    expect(ctx.headers['x-internal-service']).toBe('gateway');
  });

  it("replaces caller's own authorization header", () => {
    const { policy } = makePolicy();
    const ctx = makeCtxWith('/data', { authorization: 'Bearer caller-junk' }, { sub: 'consumer-1', data: {} });
    expect(policy.executeInbound(ctx)).toBeUndefined();
    expect(ctx.headers['authorization']).toBe('Bearer internal-secret-123');
    expect(JSON.stringify(ctx.headers)).not.toContain('caller-junk');
  });

  it('strips caller cookie', () => {
    const { policy } = makePolicy();
    const ctx = makeCtxWith('/data', { cookie: 'session=abc' }, { sub: 'consumer-1', data: {} });
    expect(policy.executeInbound(ctx)).toBeUndefined();
    expect(ctx.headers['cookie']).toBeUndefined();
  });

  it('strips caller headers colliding with injection targets', () => {
    const { policy } = makePolicy();
    const ctx = makeCtxWith('/data', { 'X-Internal-Service': 'caller-value' }, { sub: 'consumer-1', data: {} });
    expect(policy.executeInbound(ctx)).toBeUndefined();
    expect(ctx.headers['x-internal-service']).toBe('gateway');
  });

  it('returns 500 problem+json for unknown credential name', () => {
    const { policy } = makePolicy('no-such-credential');
    const ctx = makeCtxWith('/data', {}, { sub: 'consumer-1', data: {} });
    const res = policy.executeInbound(ctx) as Response;
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('bypasses public routes without auth and leaves headers untouched', () => {
    const { policy } = makePolicy();
    const ctx = makeCtxWith('/health', { authorization: 'Bearer caller-junk' });
    expect(policy.executeInbound(ctx)).toBeUndefined();
    expect(ctx.headers['authorization']).toBe('Bearer caller-junk');
    expect(ctx.state['upstreamCredential']).toBeUndefined();
  });

  it('sets upstreamCredential state marker', () => {
    const { policy } = makePolicy();
    const ctx = makeCtxWith('/data', {}, { sub: 'consumer-1', data: {} });
    policy.executeInbound(ctx);
    expect(ctx.state['upstreamCredential']).toBe('payment-service');
  });
});
