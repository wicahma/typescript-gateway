import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { AuthJwtPolicy } from '../../src/plugins/builtin/auth-jwt-policy.js';
import { generateKeyPairSync, sign, createPublicKey } from 'crypto';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function makeCtx(path = '/api/data', authorization?: string): any {
  const ctx = pool.acquire();
  ctx.requestId = 'req-test';
  ctx.method = 'GET';
  ctx.path = path;
  ctx.headers = authorization ? { authorization } : {};
  ctx.state = {};
  ctx.responded = false;
  return ctx;
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string };

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function makeToken(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'test-key' }): string {
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

const policy = new AuthJwtPolicy({
  jwks: { keys: [{ ...jwk, kid: 'test-key', alg: 'RS256' }] },
  issuer: 'https://auth.test',
  audience: 'gateway-api',
});

describe('AuthJwtPolicy (pipeline integration)', () => {
  it('short-circuits missing Authorization with a 401 problem+json Response', async () => {
    const res = await policy.executeInbound!(makeCtx('/api/data'));
    expect(res).toBeInstanceOf(Response);
    expect(res!.status).toBe(401);
    expect(res!.headers.get('content-type')).toBe('application/problem+json');
    const body = await res!.json();
    expect(body.title).toBe('Unauthorized');
    expect(body.type).toContain('unauthorized');
  });

  it('short-circuits expired token', async () => {
    const token = makeToken({ sub: 'u1', iss: 'https://auth.test', aud: 'gateway-api', exp: Math.floor(Date.now() / 1000) - 9999 });
    const res = await policy.executeInbound!(makeCtx('/api/data', `Bearer ${token}`));
    expect(res!.status).toBe(401);
    expect((await res!.json()).detail).toBe('Token has expired');
  });

  it('passes valid tokens through (returns void) and injects x-auth headers', async () => {
    const token = makeToken({ sub: 'user-1', iss: 'https://auth.test', aud: 'gateway-api', exp: Math.floor(Date.now() / 1000) + 600, jti: 'j-1' });
    const ctx = makeCtx('/api/data', `Bearer ${token}`);
    const res = await policy.executeInbound!(ctx);
    expect(res).toBeUndefined();
    expect(ctx.headers['x-auth-user-id']).toBe('user-1');
    expect(ctx.headers['x-auth-method']).toBe('bearer_jwt');
    expect(ctx.state['user'].sub).toBe('user-1');
  });

  it('strips spoofed x-auth-* headers from the caller', async () => {
    const token = makeToken({ sub: 'real', iss: 'https://auth.test', aud: 'gateway-api', exp: Math.floor(Date.now() / 1000) + 600 });
    const ctx = makeCtx('/api/data', `Bearer ${token}`);
    ctx.headers['x-auth-user-id'] = 'attacker';
    ctx.headers['x-roles'] = 'admin';
    await policy.executeInbound!(ctx);
    expect(ctx.headers['x-auth-user-id']).toBe('real');
    expect(ctx.headers['x-roles']).toBeUndefined();
  });

  it('bypasses public routes', async () => {
    const res = await policy.executeInbound!(makeCtx('/health'));
    expect(res).toBeUndefined();
  });
});
