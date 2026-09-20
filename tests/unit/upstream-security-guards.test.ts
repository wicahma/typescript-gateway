import { describe, it, expect } from 'vitest';
import { SetUpStreamHeaderPolicy } from '../../src/identity/set-upstream-header-policy.js';
import { HmacSignPolicy, verifyHmacSignature } from '../../src/identity/hmac-sign-policy.js';
import { UpstreamCredentialStore } from '../../src/identity/upstream-credential-store.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function makeCtx(overrides: Record<string, unknown> = {}): any {
  const ctx = pool.acquire() as any;
  ctx.requestId = 'req-sec-test';
  ctx.method = 'POST';
  ctx.path = '/api/protected';
  ctx.headers = {};
  ctx.body = null;
  ctx.state = {};
  ctx.responded = false;
  ctx.req = {} as any;
  ctx.res = { setHeader: () => {}, end: () => {}, statusCode: 0, headersSent: false } as any;
  Object.assign(ctx, overrides);
  return ctx;
}

describe('Upstream Credential Injection - Security & Guard Edge Cases', () => {
  const SECRET = 'ultra-secure-hmac-secret-32-bytes-long!';
  const store = new UpstreamCredentialStore([
    {
      name: 'internal-vault',
      headers: { authorization: 'Bearer internal-token', 'x-upstream-secret': 's3cr3t' },
      hmac: { secret: SECRET, keyId: 'key-v1' },
    },
  ]);

  it('ID-020 Guard: fails closed if context.user is undefined, null, or boolean false', () => {
    const headerPolicy = new SetUpStreamHeaderPolicy(store, { credentialName: 'internal-vault' });
    const hmacPolicy = new HmacSignPolicy(store, { credentialName: 'internal-vault' });

    for (const invalidUser of [undefined, null, false, '']) {
      const ctx1 = makeCtx({ state: { user: invalidUser } });
      const res1 = headerPolicy.executeInbound(ctx1) as Response;
      expect(res1).toBeInstanceOf(Response);
      expect(res1.status).toBe(401);
      expect(ctx1.headers['authorization']).toBeUndefined();

      const ctx2 = makeCtx({ state: { user: invalidUser } });
      const res2 = hmacPolicy.executeInbound(ctx2) as Response;
      expect(res2).toBeInstanceOf(Response);
      expect(res2.status).toBe(401);
      expect(ctx2.headers['x-signature']).toBeUndefined();
    }
  });

  it('ID-021: Case-insensitive stripping of sensitive caller headers', () => {
    const headerPolicy = new SetUpStreamHeaderPolicy(store, { credentialName: 'internal-vault' });
    const ctx = makeCtx({
      state: { user: { sub: 'user-1' } },
      headers: {
        AUTHORIZATION: 'Bearer caller-stolen-token',
        Cookie: 'session=123',
        'X-UPSTREAM-SECRET': 'caller-attempt',
        'x-custom-trace': 'trace-123',
      },
    });

    headerPolicy.executeInbound(ctx);

    expect(ctx.headers['authorization']).toBe('Bearer internal-token');
    expect(ctx.headers['x-upstream-secret']).toBe('s3cr3t');
    expect(ctx.headers['x-custom-trace']).toBe('trace-123');
    expect(ctx.headers['AUTHORIZATION']).toBeUndefined();
    expect(ctx.headers['Cookie']).toBeUndefined();
    expect(ctx.headers['cookie']).toBeUndefined();
    expect(ctx.headers['X-UPSTREAM-SECRET']).toBeUndefined();
  });

  it('ID-022: Tamper resistance in verifyHmacSignature against timing/structure attacks', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = Buffer.from('{"transfer":100}');
    
    expect(verifyHmacSignature(SECRET, 'POST', '/api/protected', timestamp, body, 'invalid-base64!@#')).toBe(false);
    expect(verifyHmacSignature(SECRET, 'POST', '/api/protected', 'not-a-number', body, 'AAAA')).toBe(false);
    expect(verifyHmacSignature(SECRET, 'POST', '/api/protected', timestamp, body, '')).toBe(false);
  });
});
