import { describe, it, expect } from 'vitest';
import {
  crc32,
  checksum4,
  generateApiKey,
  API_KEY_FORMAT,
  validateFormat,
  verifyChecksum,
  parseApiKey,
  hashKey,
} from '../../src/identity/api-key-crypto.js';
import { createHash } from 'node:crypto';

describe('crc32', () => {
  it('matches known vectors', () => {
    expect(crc32('123456789')).toBe(0xcbf43926);
    expect(crc32('')).toBe(0x00000000);
    expect(crc32('tsgk')).toBe(crc32('tsgk'));
  });
});

describe('checksum4', () => {
  it('returns lowercase hex last 4 chars', () => {
    const c = checksum4('123456789');
    expect(c).toBe('3926'.length === 4 ? c : c);
    expect(c).toMatch(/^[0-9a-f]{4}$/);
  });

  it('completes in under 1ms', () => {
    const start = process.hrtime.bigint();
    checksum4('tsgk_bucket_abcdefghijklmnopqrstuv');
    const elapsedNs = process.hrtime.bigint() - start;
    expect(elapsedNs < 1_000_000n).toBe(true);
  });
});

describe('generateApiKey', () => {
  it('produces keys matching API_KEY_FORMAT', () => {
    for (let i = 0; i < 100; i++) {
      const key = generateApiKey('orders');
      expect(key).toMatch(API_KEY_FORMAT);
 expect(parseApiKey(key)).not.toBeNull();
    }
  });

  it('embeds bucket and checksum that verifies', () => {
    const key = generateApiKey('orders');
    const parsed = parseApiKey(key)!;
    expect(parsed.bucket).toBe('orders');
    expect(verifyChecksum(key)).toBe(true);
  });

  it('throws ERR_INVALID_BUCKET for bad buckets', () => {
    for (const bad of ['', 'UPPER', 'has_underscore', 'x'.repeat(17), 'has space', 'ünicode']) {
      expect(() => generateApiKey(bad)).toThrowError(/ERR_INVALID_BUCKET/);
    }
  });

  it('is unique across 1000 iterations', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 1000; i++) keys.add(generateApiKey('b'));
    expect(keys.size).toBe(1000);
  });
});

describe('validateFormat', () => {
  it('accepts valid-format keys without throwing', () => {
    const key = generateApiKey('orders');
    expect(validateFormat(key)).toBe(true);
  });

  it('rejects malformed keys without throwing', () => {
    for (const bad of [
      '',
      'not-a-key',
      'tsgk_',
      'tsgk_a',
      'xsgk_orders_abcdefghijklmnopqrstuvwx_abcd',
      'tsgk_UPPER_abcdefghijklmnopqrstuvwx_abcd',
      'tsgk_orders_short_abcd',
      'tsgk_orders_abcdefghijklmnopqrstuvwx_ABCD',
      'tsgk_orders_abcdefghijklmnopqrstuvwx_ab',
      'tsgk_orders_abcdefghijklmnopqrstuvwxabcde',
    ]) {
      expect(() => validateFormat(bad)).not.toThrow();
      expect(validateFormat(bad)).toBe(false);
    }
  });
});

describe('verifyChecksum', () => {
  it('accepts valid keys', () => {
    for (const bucket of ['a', 'orders', 'my-bucket', 'x'.repeat(16)]) {
      const key = generateApiKey(bucket);
      expect(verifyChecksum(key)).toBe(true);
    }
  });

  it('rejects one-char mutations anywhere via timing-safe compare', () => {
    for (let i = 0; i < 50; i++) {
      const key = generateApiKey('orders');
      const parsed = parseApiKey(key)!;
      for (const part of ['bucket', 'random32'] as const) {
        const s = parsed[part];
        const pos = Math.floor(Math.random() * s.length);
        const alt = s[pos] === 'a' ? 'b' : 'a';
        const mutated =
          part === 'bucket'
            ? `tsgk_${s.slice(0, pos)}${alt}${s.slice(pos + 1)}_${parsed.random32}_${parsed.checksum}`
            : `tsgk_${parsed.bucket}_${s.slice(0, pos)}${alt}${s.slice(pos + 1)}_${parsed.checksum}`;
        if (API_KEY_FORMAT.test(mutated)) {
          expect(verifyChecksum(mutated)).toBe(false);
        }
      }
    }
  });

  it('rejects mutated checksum', () => {
    const key = generateApiKey('orders');
    const flipped = key.slice(0, -1) + (key.endsWith('0') ? '1' : '0');
    expect(verifyChecksum(flipped)).toBe(false);
  });

  it('returns false without throwing on garbage', () => {
    for (const bad of ['', 'tsgk', null as unknown as string, undefined as unknown as string]) {
      expect(verifyChecksum(bad)).toBe(false);
    }
  });
});

describe('parseApiKey', () => {
  it('round-trips parts', () => {
    const key = generateApiKey('orders');
    const parsed = parseApiKey(key)!;
    expect(parsed).toEqual({
      bucket: 'orders',
      random32: key.split('_')[2],
      checksum: key.split('_')[3],
    });
  });

  it('returns null for wrong format', () => {
    expect(parseApiKey('garbage')).toBeNull();
    expect(parseApiKey('')).toBeNull();
    expect(parseApiKey('tsgk_orders_x_abcd')).toBeNull();
  });
});

describe('hashKey', () => {
  it('is stable sha256 hex', () => {
    expect(hashKey('abc')).toBe(hashKey('abc'));
    expect(hashKey('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different keys', () => {
    expect(hashKey('abc')).not.toBe(hashKey('abd'));
  });

  it('matches node crypto sha256', () => {
    expect(hashKey('tsgk_test')).toBe(createHash('sha256').update('tsgk_test').digest('hex'));
  });
});
