import { describe, it, expect } from 'vitest';
import { generateApiKey } from '../../src/identity/api-key-crypto.js';
import { ConsumerStore } from '../../src/identity/consumer-store.js';

const key = () => generateApiKey('live');

describe('createConsumer', () => {
  it('creates a consumer with plan and rateLimit', () => {
    const store = new ConsumerStore();
    const c = store.createConsumer('c1', 'pro', 500);
    expect(c).toEqual({ consumerId: 'c1', plan: 'pro', rateLimit: 500 });
  });

  it('defaults to free plan with rateLimit 1000', () => {
    const store = new ConsumerStore();
    expect(store.createConsumer('c1')).toEqual({ consumerId: 'c1', plan: 'free', rateLimit: 1000 });
  });

  it('rejects duplicate consumer id with ERR_CONSUMER_EXISTS', () => {
    const store = new ConsumerStore();
    store.createConsumer('c1');
    expect(() => store.createConsumer('c1')).toThrow('ERR_CONSUMER_EXISTS');
  });

  it('returns null for unknown consumer', () => {
    const store = new ConsumerStore();
    expect(store.getConsumer('nope')).toBeNull();
  });
});

describe('issueKey', () => {
  it('rejects unknown consumer with ERR_CONSUMER_NOT_FOUND', () => {
    const store = new ConsumerStore();
    expect(() => store.issueKey('nope', key())).toThrow('ERR_CONSUMER_NOT_FOUND');
  });

  it('issues an ACTIVE key for an existing consumer', () => {
    const store = new ConsumerStore();
    store.createConsumer('c1');
    const rec = store.issueKey('c1', key());
    expect(rec.consumerId).toBe('c1');
    expect(rec.status).toBe('ACTIVE');
    expect(rec.expiresAt).toBeNull();
    expect(rec.createdAt).toBeGreaterThan(0);
  });

  it('honors expiresAt option', () => {
    const store = new ConsumerStore();
    store.createConsumer('c1');
    const rec = store.issueKey('c1', key(), { expiresAt: 9999999999999 });
    expect(rec.expiresAt).toBe(9999999999999);
  });
});

describe('resolveKey', () => {
  it('resolves a valid key to its consumer record', () => {
    const store = new ConsumerStore();
    store.createConsumer('c1', 'pro', 42);
    const k1 = key();
    const k2 = key();
    store.issueKey('c1', k1);
    store.createConsumer('c2');
    store.issueKey('c2', k2);
    expect(store.resolveKey(k1)?.consumerId).toBe('c1');
    expect(store.resolveKey(k2)?.consumerId).toBe('c2');
  });

  it('does not make plaintext retrievable', () => {
    const store = new ConsumerStore() as unknown as { keys: Map<string, unknown> };
    const k = key();
    store.createConsumer('c1');
    store.issueKey('c1', k);
    for (const v of store.keys.values()) {
      expect(JSON.stringify(v)).not.toContain(k);
    }
  });

  it('returns null for unknown key', () => {
    const store = new ConsumerStore();
    expect(store.resolveKey(key())).toBeNull();
  });

  it('returns null for revoked key', () => {
    const store = new ConsumerStore();
    store.createConsumer('c1');
    const k = key();
    store.issueKey('c1', k);
    store.revokeKey(k);
    expect(store.resolveKey(k)).toBeNull();
  });

  it('throws ERR_KEY_EXPIRED for expired key', () => {
    const store = new ConsumerStore();
    store.createConsumer('c1');
    const k = key();
    store.issueKey('c1', k, { expiresAt: Date.now() - 1000 });
    expect(() => store.resolveKey(k)).toThrow('ERR_KEY_EXPIRED');
  });
});

describe('revokeKey', () => {
  it('returns true on first revoke, false afterwards', () => {
    const store = new ConsumerStore();
    store.createConsumer('c1');
    const k = key();
    store.issueKey('c1', k);
    expect(store.revokeKey(k)).toBe(true);
    expect(store.revokeKey(k)).toBe(false);
  });

  it('returns false for unknown key', () => {
    const store = new ConsumerStore();
    expect(store.revokeKey(key())).toBe(false);
  });
});

describe('stats', () => {
  it('counts consumers, keys and revoked', () => {
    const store = new ConsumerStore();
    store.createConsumer('c1');
    store.createConsumer('c2');
    const k1 = key();
    const k2 = key();
    store.issueKey('c1', k1);
    store.issueKey('c2', k2);
    store.revokeKey(k1);
    expect(store.stats()).toEqual({ consumers: 2, keys: 2, revoked: 1 });
  });
});

describe('plan/rateLimit round-trip', () => {
  it('resolveKey returns the consumer plan and rateLimit', () => {
    const store = new ConsumerStore();
    store.createConsumer('c1', 'enterprise', 9999);
    const k = key();
    store.issueKey('c1', k);
    const c = store.resolveKey(k);
    expect(c?.plan).toBe('enterprise');
    expect(c?.rateLimit).toBe(9999);
  });
});
