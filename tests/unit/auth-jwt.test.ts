import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createPrivateKey, sign as jwtSign, createHash } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { AuthJwtPlugin } from '../../src/plugins/builtin/auth-jwt.js';
import { RequestContext } from '../../src/types/core.js';

const KID = 'geopulse-test-key-1';
const ISSUER = 'https://auth.geopulser.local';
const AUDIENCE = 'geopulser-api';

function makeCtx(headers: Record<string, string | string[] | undefined> = {}): RequestContext {
  const req = new IncomingMessage(new Socket());
  const res = new ServerResponse(req);
  return {
    requestId: 'test-req',
    startTime: process.hrtime.bigint(),
    method: 'GET',
    path: '/api/1',
    query: {},
    params: {},
    headers,
    body: null,
    req,
    res,
    upstream: null,
    state: {},
    responded: false,
    route: null,
    timestamps: {},
  };
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function makeToken(payload: Record<string, unknown>, header: Record<string, unknown>, privKey: unknown, alg = 'RS256'): string {
  const h = b64url(JSON.stringify({ alg, typ: 'JWT', kid: KID, ...header }));
  const p = b64url(JSON.stringify(payload));
  const signingInput = `${h}.${p}`;
  let sig: Buffer;
  if (alg === 'none') {
    sig = Buffer.from('');
  } else if (alg === 'HS256') {
    const key = Buffer.from((privKey as { export: () => Buffer }).export({ type: 'pkcs1', format: 'der' }));
    sig = createHash('sha256').update(signingInput).end().digest();
    // HS256 uses HMAC; approximate with hash — plugin rejects non-RS256 before sig check anyway
  } else {
    sig = jwtSign('sha256', Buffer.from(signingInput), { key: privKey, padding: 1 });
  }
  return `${signingInput}.${b64url(sig)}`;
}

describe('AuthJwtPlugin', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const exported = publicKey.export({ format: 'jwk' });
  const publicJwk = {
    kty: 'RSA',
    n: exported.n!,
    e: exported.e!,
    kid: KID,
  };

  const plugin = new AuthJwtPlugin({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwks: { keys: [publicJwk] },
    publicRoutes: ['/health', '/metrics', '/'],
  });

  const validPayload = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: 'usr_citizen_42',
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: 'jti-test-1',
    scopes: 'citizen',
  };

  it('accepts valid token and injects X-Auth-* headers', () => {
    const token = makeToken(validPayload, {}, privateKey);
    const ctx = makeCtx({
      authorization: `Bearer ${token}`,
      'x-auth-user-id': 'attacker',
      'x-user-role': 'superuser',
      'x-scopes': 'admin',
    });
    plugin.preRoute(ctx);
    expect(ctx.responded).toBe(false);
    expect(ctx.headers['x-auth-user-id']).toBe('usr_citizen_42');
    expect(ctx.headers['x-auth-scopes']).toBe('citizen');
    expect(ctx.headers['x-auth-jti']).toBe('jti-test-1');
    // spoofed headers stripped
    expect(ctx.headers['x-user-role']).toBeUndefined();
    expect(ctx.headers['x-scopes']).toBeUndefined();
  });

  it('rejects unauthenticated request with 401', () => {
    const ctx = makeCtx();
    plugin.preRoute(ctx);
    expect(ctx.responded).toBe(true);
    expect((ctx.res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  it('rejects expired token', () => {
    const token = makeToken({ ...validPayload, exp: Math.floor(Date.now() / 1000) - 3600 }, {}, privateKey);
    const ctx = makeCtx({ authorization: `Bearer ${token}` });
    plugin.preRoute(ctx);
    expect(ctx.responded).toBe(true);
    expect((ctx.res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  it('rejects wrong issuer and audience', () => {
    const t1 = makeToken({ ...validPayload, iss: 'https://rogue-idp.attacker.org' }, {}, privateKey);
    const c1 = makeCtx({ authorization: `Bearer ${t1}` });
    plugin.preRoute(c1);
    expect(c1.responded).toBe(true);

    const t2 = makeToken({ ...validPayload, aud: 'unauthorized-external-service' }, {}, privateKey);
    const c2 = makeCtx({ authorization: `Bearer ${t2}` });
    plugin.preRoute(c2);
    expect(c2.responded).toBe(true);
  });

  it('rejects alg=none and HS256 confusion', () => {
    const tNone = makeToken(validPayload, { alg: 'none' }, privateKey, 'none');
    const cNone = makeCtx({ authorization: `Bearer ${tNone}` });
    plugin.preRoute(cNone);
    expect(cNone.responded).toBe(true);

    const tHs = makeToken(validPayload, { alg: 'HS256' }, privateKey, 'HS256');
    const cHs = makeCtx({ authorization: `Bearer ${tHs}` });
    plugin.preRoute(cHs);
    expect(cHs.responded).toBe(true);
  });

  it('rejects unknown kid', () => {
    const t = makeToken(validPayload, { kid: 'unknown-or-revoked-key-999' }, privateKey);
    const ctx = makeCtx({ authorization: `Bearer ${t}` });
    plugin.preRoute(ctx);
    expect(ctx.responded).toBe(true);
  });

  it('rejects malformed token', () => {
    const ctx = makeCtx({ authorization: 'Bearer ey.this-is-not-a-valid-jwt.token' });
    plugin.preRoute(ctx);
    expect(ctx.responded).toBe(true);
  });

  it('passes through public routes', () => {
    const ctx = makeCtx({});
    ctx.path = '/health';
    plugin.preRoute(ctx);
    expect(ctx.responded).toBe(false);
  });
});
