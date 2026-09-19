import { GatewayPolicy } from '../pipeline/policy.js';
import { RequestContext } from '../types/core.js';
import { HttpProblems } from '../pipeline/http-problems.js';
import { validateFormat, verifyChecksum, hashKey } from './api-key-crypto.js';
import { ConsumerStore } from './consumer-store.js';
import { logger } from '../utils/logger.js';

export interface ApiKeyPolicyConfig {
  publicRoutes?: string[];
  headerName?: string;
  cacheTtlSeconds?: number;
  cacheMaxEntries?: number;
}

interface CacheEntry {
  consumerId: string;
  plan: string;
  rateLimit: number;
  expiresAt: number;
}

const EXPIRED: unique symbol = Symbol('ERR_KEY_EXPIRED');

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}

export class ApiKeyPolicy implements GatewayPolicy {
  readonly name = 'api-key-auth';

  private cache = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;
  private readonly publicRoutes: Set<string>;
  private readonly headerName: string;
  private readonly cacheTtlSeconds: number;
  private readonly cacheMaxEntries: number;

  constructor(
    private store: ConsumerStore,
    config: ApiKeyPolicyConfig = {},
  ) {
    this.publicRoutes = new Set(config.publicRoutes ?? ['/', '/health', '/metrics']);
    this.headerName = config.headerName ?? 'x-api-key';
    this.cacheTtlSeconds = config.cacheTtlSeconds ?? 5;
    this.cacheMaxEntries = config.cacheMaxEntries ?? 10000;
  }

  executeInbound(ctx: RequestContext): Response | void {
    if (this.publicRoutes.has(ctx.path)) return;

    const key = this.extractKey(ctx);
    if (!key) return HttpProblems.unauthorized('Missing API key');

    if (!validateFormat(key)) return HttpProblems.unauthorized('Invalid API key format');
    if (!verifyChecksum(key)) return HttpProblems.unauthorized('API key checksum mismatch');

    const record = this.resolve(key);
    if (record === EXPIRED) return HttpProblems.unauthorized('API key has expired');
    if (!record) return HttpProblems.unauthorized('API key not found');

    ctx.state['user'] = { sub: record.consumerId, data: { plan: record.plan, rateLimit: record.rateLimit } };
    logger.info({ requestId: ctx.requestId, sub: record.consumerId, plan: record.plan }, 'API key auth succeeded');
  }

  stats(): CacheStats {
    return { hits: this.hits, misses: this.misses, size: this.cache.size };
  }

  private extractKey(ctx: RequestContext): string | null {
    const header = ctx.headers[this.headerName];
    if (typeof header === 'string' && header.length > 0) return header;
    const auth = ctx.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
    return null;
  }

  private resolve(key: string): CacheEntry | null | typeof EXPIRED {
    const cacheKey = hashKey(key);
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      this.hits++;
      return cached;
    }
    if (cached) this.cache.delete(cacheKey);

    this.misses++;
    let record: { consumerId: string; plan: string; rateLimit: number } | null;
    try {
      record = this.store.resolveKey(key);
    } catch (err) {
      if (err instanceof Error && err.message === 'ERR_KEY_EXPIRED') return EXPIRED;
      throw err;
    }
    if (!record) return null;

    const entry: CacheEntry = {
      consumerId: record.consumerId,
      plan: record.plan,
      rateLimit: record.rateLimit,
      expiresAt: now + this.cacheTtlSeconds * 1000,
    };
    this.cache.set(cacheKey, entry);
    if (this.cache.size > this.cacheMaxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return entry;
  }
}
