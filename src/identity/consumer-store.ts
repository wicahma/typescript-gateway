import { hashKey } from './api-key-crypto.js';

export interface ConsumerRecord {
  consumerId: string;
  plan: string;
  rateLimit: number;
}

export interface ApiKeyRecord {
  keyHash: string;
  consumerId: string;
  status: 'ACTIVE' | 'REVOKED';
  expiresAt: number | null;
  createdAt: number;
}

export class ConsumerStore {
  private consumers = new Map<string, ConsumerRecord>();
  private keys = new Map<string, ApiKeyRecord>();

  createConsumer(consumerId: string, plan = 'free', rateLimit = 1000): ConsumerRecord {
    if (this.consumers.has(consumerId)) throw new Error('ERR_CONSUMER_EXISTS');
    const record: ConsumerRecord = { consumerId, plan, rateLimit };
    this.consumers.set(consumerId, record);
    return record;
  }

  getConsumer(consumerId: string): ConsumerRecord | null {
    return this.consumers.get(consumerId) ?? null;
  }

  issueKey(consumerId: string, key: string, opts?: { expiresAt?: number }): ApiKeyRecord {
    if (!this.consumers.has(consumerId)) throw new Error('ERR_CONSUMER_NOT_FOUND');
    const record: ApiKeyRecord = {
      keyHash: hashKey(key),
      consumerId,
      status: 'ACTIVE',
      expiresAt: opts?.expiresAt ?? null,
      createdAt: Date.now(),
    };
    this.keys.set(record.keyHash, record);
    return record;
  }

  revokeKey(key: string): boolean {
    const record = this.keys.get(hashKey(key));
    if (!record || record.status === 'REVOKED') return false;
    record.status = 'REVOKED';
    return true;
  }

  resolveKey(key: string): ConsumerRecord | null {
    const record = this.keys.get(hashKey(key));
    if (!record) return null;
    if (record.status === 'REVOKED') return null;
    if (record.expiresAt !== null && record.expiresAt <= Date.now()) {
      throw new Error('ERR_KEY_EXPIRED');
    }
    return this.consumers.get(record.consumerId) ?? null;
  }

  stats(): { consumers: number; keys: number; revoked: number } {
    let revoked = 0;
    for (const record of this.keys.values()) {
      if (record.status === 'REVOKED') revoked += 1;
    }
    return { consumers: this.consumers.size, keys: this.keys.size, revoked };
  }
}
