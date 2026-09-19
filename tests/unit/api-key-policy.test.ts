import { describe, it, expect } from 'vitest';
import { generateApiKey } from '../../src/identity/api-key-crypto.js';
import { ConsumerStore } from '../../src/identity/consumer-store.js';
import { ApiKeyPolicy } from '../../src/identity/api-key-policy.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function makeCtx(headers: Record<string, string> = {}, path = '/data'): any {
  const ctx = pool.acquire();
  ctx.requestId = 'req-test-1';
  ctx.method = 'GET';
  ctx.path = path;
  ctx.headers = headers;
  ctx.state = {};
  ctx.responded = false;
  return ctx;
}

function provision() {
  const store = new ConsumerStore();
  store.createConsumer('cust-1', 'pro', 5000);
  const key = generateApiKey('live');
  store.issueKey('cust-1', key);
  return { store, key };
}

function problem(res: Response) {
  return res.json() as Promise<{ type: string; title: string; status: number; detail?: string }>;
}

describe('ApiKeyPolicy', () => {
  it('returns 401 problem+json for missing key', async () => {
    const { store } = provision();
    const policy = new ApiKeyPolicy(store);
    const res = policy.executeInbound(makeCtx());
    expect(res).toBeInstanceOf(Response);
    const body = await (res as Response).json();
    expect((res as Response).status).toBe(401);
    expect((res as Response).headers.get('content-type')).toBe('application/problem+json');
    expect(body.title).toBe('Unauthorized');
    expect(body.type).toBe('https://gateway.internal/errors/unauthorized');
    expect(body.detail).toBe('Missing API key');
  });

  it('returns 401 Invalid API key format for malformed key', async () => {
    const { store } = provision();
    const policy = new ApiKeyPolicy(store);
    const res = policy.executeInbound(makeCtx({ 'x-api-key': 'not-a-key' })) as Response;
    const body = await problem(res);
    expect(res.status).toBe(401);
    expect(body.detail).toBe('Invalid API key format');
  });

  it('returns 401 API key checksum mismatch for tampered checksum', async () => {
    const { store, key } = provision();
    const policy = new ApiKeyPolicy(store);
    const tampered = key.slice(0, -4) + '0000';
    const res = policy.executeInbound(makeCtx({ 'x-api-key': tampered })) as Response;
    const body = await problem(res);
    expect(res.status).toBe(401);
    expect(body.detail).toBe('API key checksum mismatch');
  });

  it('validates a good key: void return, user injected into state', () => {
    const { store, key } = provision();
    const policy = new ApiKeyPolicy(store);
    const ctx = makeCtx({ 'x-api-key': key });
    expect(policy.executeInbound(ctx)).toBeUndefined();
    const user = ctx.state['user'] as { sub: string; data: { plan: string; rateLimit: number } };
    expect(user.sub).toBe('cust-1');
    expect(user.data.plan).toBe('pro');
    expect(user.data.rateLimit).toBe(5000);
  });

  it('bypasses public routes without a key', () => {
    const { store } = provision();
    const policy = new ApiKeyPolicy(store);
    for (const path of ['/', '/health', '/metrics']) {
      expect(policy.executeInbound(makeCtx({}, path))).toBeUndefined();
    }
  });

  it('caches positive resolution: second validation hits cache', () => {
    const { store, key } = provision();
    const policy = new ApiKeyPolicy(store);
    policy.executeInbound(makeCtx({ 'x-api-key': key }));
    const before = policy.stats().hits;
    policy.executeInbound(makeCtx({ 'x-api-key': key }));
    expect(policy.stats().hits).toBe(before + 1);
  });

  it('revoked key with cold cache returns 401 not found', async () => {
    const { store, key } = provision();
    const first = new ApiKeyPolicy(store);
    first.executeInbound(makeCtx({ 'x-api-key': key }));
    store.revokeKey(key);
    const policy = new ApiKeyPolicy(store);
    const res = policy.executeInbound(makeCtx({ 'x-api-key': key })) as Response;
    const body = await problem(res);
    expect(res.status).toBe(401);
    expect(body.detail).toBe('API key not found');
  });

  it('expired key returns 401 API key has expired', async () => {
    const store = new ConsumerStore();
    store.createConsumer('cust-1', 'pro', 5000);
    const key = generateApiKey('live');
    store.issueKey('cust-1', key, { expiresAt: Date.now() - 1000 });
    const policy = new ApiKeyPolicy(store);
    const res = policy.executeInbound(makeCtx({ 'x-api-key': key })) as Response;
    const body = await problem(res);
    expect(res.status).toBe(401);
    expect(body.detail).toBe('API key has expired');
  });

  it('falls back to authorization: Bearer <key>', () => {
    const { store, key } = provision();
    const policy = new ApiKeyPolicy(store);
    const ctx = makeCtx({ authorization: `Bearer ${key}` });
    expect(policy.executeInbound(ctx)).toBeUndefined();
    expect((ctx.state['user'] as { sub: string }).sub).toBe('cust-1');
  });

  it('LRU evicts oldest entries beyond cacheMaxEntries', () => {
    const store = new ConsumerStore();
    const keys: string[] = [];
    for (let i = 0; i < 3; i++) {
      store.createConsumer(`c${i}`, 'pro', 100);
      keys.push(generateApiKey('live'));
      store.issueKey(`c${i}`, keys[i]);
    }
    const policy = new ApiKeyPolicy(store, { cacheMaxEntries: 2 });
    for (const k of keys) policy.executeInbound(makeCtx({ 'x-api-key': k }));
    expect(policy.stats().size).toBe(2);
  });

  it('unknown key returns 401 API key not found', async () => {
    const { store } = provision();
    const policy = new ApiKeyPolicy(store);
    const res = policy.executeInbound(makeCtx({ 'x-api-key': generateApiKey('live') })) as Response;
    const body = await problem(res);
    expect(res.status).toBe(401);
    expect(body.detail).toBe('API key not found');
  });
});
