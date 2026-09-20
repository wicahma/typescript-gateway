import { describe, it, expect } from 'vitest';
import {
  UpstreamCredentialStore,
  type UpstreamCredential,
} from '../../src/identity/upstream-credential-store.js';

const staticHeaders: UpstreamCredential = {
  name: 'payment-svc',
  headers: { 'x-api-key': 'pay-live-key-7f3a', 'x-tenant': 'acme' },
};

const hmacCredential: UpstreamCredential = {
  name: 'ledger-svc',
  headers: { 'x-client-id': 'ledger-01' },
  hmac: { secret: 'hmac-secret-9d21c4', keyId: 'ledger-key-2026', headerNamespace: 'x-ledger-auth' },
};

describe('UpstreamCredentialStore construction', () => {
  it('rejects duplicate credential names with ERR_CREDENTIAL_DUPLICATE', () => {
    expect(() => new UpstreamCredentialStore([staticHeaders, { ...staticHeaders }])).toThrow(
      'ERR_CREDENTIAL_DUPLICATE',
    );
  });
});

describe('get', () => {
  it('returns the credential for a known name', () => {
    const store = new UpstreamCredentialStore([staticHeaders, hmacCredential]);
    expect(store.get('ledger-svc')).toEqual(hmacCredential);
  });

  it('returns null for an unknown name', () => {
    const store = new UpstreamCredentialStore([staticHeaders]);
    expect(store.get('ghost-svc')).toBeNull();
  });
});

describe('resolveHeaderValues', () => {
  it('returns the exact header map for a known credential', () => {
    const store = new UpstreamCredentialStore([staticHeaders]);
    expect(store.resolveHeaderValues('payment-svc')).toEqual({
      'x-api-key': 'pay-live-key-7f3a',
      'x-tenant': 'acme',
    });
  });

  it('returns null for an unknown name', () => {
    const store = new UpstreamCredentialStore([]);
    expect(store.resolveHeaderValues('ghost-svc')).toBeNull();
  });
});

describe('getHmacSecret', () => {
  it('returns secret, keyId and headerNamespace for a credential with an hmac block', () => {
    const store = new UpstreamCredentialStore([hmacCredential]);
    expect(store.getHmacSecret('ledger-svc')).toEqual({
      secret: 'hmac-secret-9d21c4',
      keyId: 'ledger-key-2026',
      headerNamespace: 'x-ledger-auth',
    });
  });

  it('returns null for a credential without an hmac block', () => {
    const store = new UpstreamCredentialStore([staticHeaders]);
    expect(store.getHmacSecret('payment-svc')).toBeNull();
  });

  it('returns null for an unknown name', () => {
    const store = new UpstreamCredentialStore([staticHeaders]);
    expect(store.getHmacSecret('ghost-svc')).toBeNull();
  });
});

describe('rotate', () => {
  it('replaces values so subsequent reads return the new version and never the old one', () => {
    const store = new UpstreamCredentialStore([staticHeaders]);
    const next: UpstreamCredential = {
      name: 'payment-svc',
      headers: { 'x-api-key': 'pay-live-key-rotation-aa11' },
    };
    expect(store.rotate('payment-svc', next)).toBe(true);
    expect(store.get('payment-svc')).toEqual(next);
    expect(store.resolveHeaderValues('payment-svc')).toEqual({
      'x-api-key': 'pay-live-key-rotation-aa11',
    });
    const resolved = JSON.stringify(store.resolveHeaderValues('payment-svc'));
    expect(resolved).not.toContain('pay-live-key-7f3a');
  });

  it('rotates the hmac block along with the credential', () => {
    const store = new UpstreamCredentialStore([hmacCredential]);
    const next: UpstreamCredential = {
      name: 'ledger-svc',
      headers: { 'x-client-id': 'ledger-01' },
      hmac: { secret: 'hmac-secret-rotated-e55b', keyId: 'ledger-key-2027' },
    };
    expect(store.rotate('ledger-svc', next)).toBe(true);
    expect(store.getHmacSecret('ledger-svc')).toEqual({
      secret: 'hmac-secret-rotated-e55b',
      keyId: 'ledger-key-2027',
    });
    expect(JSON.stringify(store.getHmacSecret('ledger-svc'))).not.toContain('hmac-secret-9d21c4');
  });

  it('returns false for an unknown name and leaves the store untouched', () => {
    const store = new UpstreamCredentialStore([staticHeaders]);
    const next: UpstreamCredential = { name: 'ghost-svc', headers: { 'x-api-key': 'nope' } };
    expect(store.rotate('ghost-svc', next)).toBe(false);
    expect(store.get('ghost-svc')).toBeNull();
  });
});

describe('stats', () => {
  it('counts credentials and those with an hmac block', () => {
    const store = new UpstreamCredentialStore([staticHeaders, hmacCredential]);
    expect(store.stats()).toEqual({ credentials: 2, withHmac: 1 });
  });

  it('returns zeros for an empty store', () => {
    expect(new UpstreamCredentialStore().stats()).toEqual({ credentials: 0, withHmac: 0 });
  });
});
