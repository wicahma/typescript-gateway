import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(input: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < input.length; i++) {
    crc = (CRC_TABLE[(crc ^ input.charCodeAt(i)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function checksum4(input: string): string {
  return crc32(input).toString(16).toLowerCase().padStart(8, '0').slice(-4);
}

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function toBase62(bytes: Buffer, length: number): string {
  let acc = 0n;
  for (const b of bytes) acc = (acc << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < length; i++) {
    const idx = Number(acc % 62n);
    out = (BASE62[idx] ?? '0') + out;
    acc /= 62n;
  }
  return out;
}

export const API_KEY_FORMAT = /^tsgk_[a-z0-9-]{1,16}_[A-Za-z0-9]{32}_[0-9a-f]{4}$/;

export const BUCKET_FORMAT = /^[a-z0-9-]{1,16}$/;

export function generateApiKey(bucket: string): string {
  if (!BUCKET_FORMAT.test(bucket)) {
    throw new Error('ERR_INVALID_BUCKET');
  }
  const random32 = toBase62(randomBytes(24), 32);
  const prefix = `tsgk_${bucket}_${random32}`;
  return `${prefix}_${checksum4(prefix)}`;
}

export function validateFormat(key: string): boolean {
  return API_KEY_FORMAT.test(key);
}

export function parseApiKey(key: string): { bucket: string; random32: string; checksum: string } | null {
  if (!API_KEY_FORMAT.test(key)) return null;
  const parts = key.split('_');
  return { bucket: parts[1]!, random32: parts[2]!, checksum: parts[3]! };
}

export function verifyChecksum(key: string): boolean {
  const parsed = parseApiKey(key);
  if (!parsed) return false;
  const prefix = `tsgk_${parsed.bucket}_${parsed.random32}`;
  const expected = Buffer.from(checksum4(prefix), 'utf8');
  const actual = Buffer.from(parsed.checksum, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
