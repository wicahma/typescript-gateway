/**
 * Cache Plugin
 * HTTP response caching with smart invalidation
 * Phase 5: Advanced Features
 */

import { Plugin } from '../../types/plugin.js';
import { RequestContext } from '../../types/core.js';
import { ResponseCache, CachedResponse } from '../../core/response-cache.js';
import { logger } from '../../utils/logger.js';
import { pluginContextManager } from '../context-manager.js';

/**
 * Cache strategy configuration
 */
export interface CacheStrategy {
  /** Routes to cache (glob patterns) */
  routes: string[];
  /** TTL in seconds */
  ttl?: number;
  /** Headers to vary on */
  varyHeaders?: string[];
  /** Stale-while-revalidate duration */
  staleWhileRevalidate?: number;
  /** Cache private responses */
  cachePrivate?: boolean;
  /** Methods to cache */
  methods?: string[];
}

/**
 * Cache plugin configuration
 */
export interface CacheConfig {
  /** Enable caching */
  enabled: boolean;
  /** Cache type */
  type?: 'memory';
  /** Maximum cache size in MB */
  maxSize?: number;
  /** Maximum number of entries */
  maxEntries?: number;
  /** Default TTL in seconds */
  defaultTTL?: number;
  /** Cache strategies */
  strategies?: CacheStrategy[];
  /** Enable cache statistics */
  enableStats?: boolean;
}

/**
 * Cache plugin
 * Implements HTTP response caching with Cache-Control support
 */
export class CachePlugin implements Plugin {
  name = 'cache';
  version = '1.0.0';
  description = 'HTTP response caching with smart invalidation';
  author = 'Gateway Team';

  private config: Required<CacheConfig> = {
    enabled: true,
    type: 'memory',
    maxSize: 100,
    maxEntries: 10000,
    defaultTTL: 300,
    strategies: [],
    enableStats: true,
  };

  private cache: ResponseCache | null = null;

  init(config: Record<string, unknown>): void {
    if ('enabled' in config && config['enabled'] !== undefined) {
      this.config.enabled = Boolean(config['enabled']);
    }

    if ('type' in config && config['type']) {
      this.config.type = config['type'] as 'memory';
    }

    if ('maxSize' in config && typeof config['maxSize'] === 'number') {
      this.config.maxSize = config['maxSize'];
    }

    if ('maxEntries' in config && typeof config['maxEntries'] === 'number') {
      this.config.maxEntries = config['maxEntries'];
    }

    if ('defaultTTL' in config && typeof config['defaultTTL'] === 'number') {
      this.config.defaultTTL = config['defaultTTL'];
    }

    if ('strategies' in config && Array.isArray(config['strategies'])) {
      this.config.strategies = config['strategies'] as CacheStrategy[];
    }

    if ('enableStats' in config && config['enableStats'] !== undefined) {
      this.config.enableStats = Boolean(config['enableStats']);
    }

    // Initialize cache
    if (this.config.enabled) {
      this.cache = new ResponseCache({
        maxSize: this.config.maxSize * 1024 * 1024, // Convert MB to bytes
        maxEntries: this.config.maxEntries,
        defaultTTL: this.config.defaultTTL,
        enableStats: this.config.enableStats,
      });

      logger.info({
        maxSize: this.config.maxSize,
        maxEntries: this.config.maxEntries,
        strategies: this.config.strategies.length,
      }, 'Response cache initialized');
    }
  }

  async preHandler(ctx: RequestContext): Promise<void> {
    if (!this.config.enabled || !this.cache) {
      return;
    }

    // Find matching strategy
    const strategy = this.findMatchingStrategy(ctx);
    if (!strategy) {
      return;
    }

    // Check if method is cacheable
    const methods = strategy.methods ?? ['GET', 'HEAD'];
    if (!methods.includes(ctx.method)) {
      return;
    }

    // Extract vary headers
    const varyHeaders: Record<string, string | string[] | undefined> = {};
    if (strategy.varyHeaders) {
      for (const header of strategy.varyHeaders) {
        varyHeaders[header] = ctx.headers[header.toLowerCase()];
      }
    }

    // Generate cache key
    const cacheKey = this.cache.generateKey(ctx.method, ctx.path, varyHeaders);

    // Store key for later use
    pluginContextManager.setShared(ctx, 'cacheKey', cacheKey);
    pluginContextManager.setShared(ctx, 'cacheStrategy', strategy);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached) {
      // Check conditional requests
      const ifNoneMatch = ctx.headers['if-none-match'] as string | undefined;
      const ifModifiedSince = ctx.headers['if-modified-since'] as string | undefined;

      if (ResponseCache.checkConditional(ifNoneMatch, ifModifiedSince, cached)) {
        // Return 304 Not Modified
        ctx.res.statusCode = 304;
        if (cached.etag) {
          ctx.res.setHeader('ETag', cached.etag);
        }
        if (cached.lastModified) {
          ctx.res.setHeader('Last-Modified', cached.lastModified);
        }
        ctx.res.end();
        ctx.responded = true;

        logger.debug({ requestId: ctx.requestId, cacheKey }, 'Cache hit: 304 Not Modified');
        return;
      }

      // Serve from cache
      ctx.res.statusCode = cached.statusCode;

      // Copy headers
      for (const [key, value] of Object.entries(cached.headers)) {
        ctx.res.setHeader(key, value);
      }

      // Add cache headers
      const age = Math.floor((Date.now() - cached.cachedAt) / 1000);
      ctx.res.setHeader('Age', age.toString());
      ctx.res.setHeader('X-Cache', 'HIT');

      // Send body
      ctx.res.end(cached.body);
      ctx.responded = true;

      logger.debug({ requestId: ctx.requestId, cacheKey, age }, 'Cache hit');
      return;
    }

    // Cache miss
    ctx.res.setHeader('X-Cache', 'MISS');
    logger.debug({ requestId: ctx.requestId, cacheKey }, 'Cache miss');
  }

  async postHandler(ctx: RequestContext): Promise<void> {
    if (!this.config.enabled || !this.cache || ctx.responded) {
      return;
    }

    const cacheKey = pluginContextManager.getShared<string>(ctx, 'cacheKey');
    const strategy = pluginContextManager.getShared<CacheStrategy>(ctx, 'cacheStrategy');

    if (!cacheKey || !strategy) {
      return;
    }

    // Check if response is cacheable
    const statusCode = ctx.res.statusCode;
    if (!ResponseCache.isCacheable(statusCode, ctx.res.getHeaders(), ctx.method)) {
      return;
    }

    // Parse Cache-Control
    const cacheControlHeader = ctx.res.getHeader('cache-control') as string | undefined;
    const cacheControl = ResponseCache.parseCacheControl(cacheControlHeader);

    // Check if private responses should be cached
    if (cacheControl.private && !strategy.cachePrivate) {
      return;
    }

    // Don't cache if no-store or no-cache
    if (cacheControl.noStore || cacheControl.noCache) {
      return;
    }

    // Get body from response (we need to intercept the response)
    // This is a simplified implementation - in production, we'd need to intercept res.write/res.end
    const body = ctx.state['__cacheBody'] as Buffer | undefined;
    if (!body) {
      // If body wasn't captured, we can't cache
      return;
    }

    // Determine TTL
    const ttl = strategy.ttl ?? this.cache.getTTL(cacheControl);

    // Generate ETag if not present
    let etag = ctx.res.getHeader('etag') as string | undefined;
    if (!etag) {
      etag = ResponseCache.generateETag(body);
      ctx.res.setHeader('ETag', etag);
    }

    // Get Last-Modified if present
    const lastModified = ctx.res.getHeader('last-modified') as string | undefined;

    // Create cached response
    const cachedResponse: CachedResponse = {
      statusCode,
      headers: ctx.res.getHeaders() as Record<string, string | string[]>,
      body,
      cachedAt: Date.now(),
      ttl,
      etag,
      lastModified,
      size: body.length,
      staleWhileRevalidate: strategy.staleWhileRevalidate ?? cacheControl.staleWhileRevalidate,
    };

    // Store in cache
    const stored = this.cache.set(cacheKey, cachedResponse);
    
    if (stored) {
      logger.debug({ requestId: ctx.requestId, cacheKey, ttl, size: body.length }, 'Response cached');
    } else {
      logger.warn({ requestId: ctx.requestId, cacheKey, size: body.length }, 'Failed to cache response');
    }
  }

  destroy(): void {
    if (this.cache) {
      this.cache.clear();
      this.cache = null;
    }
  }

  /**
   * Find matching cache strategy for request
   */
  private findMatchingStrategy(ctx: RequestContext): CacheStrategy | null {
    for (const strategy of this.config.strategies) {
      if (this.matchesRoute(ctx.path, strategy.routes)) {
        return strategy;
      }
    }
    return null;
  }

  /**
   * Check if path matches route patterns
   */
  private matchesRoute(path: string, routes: string[]): boolean {
    for (const route of routes) {
      if (this.matchPattern(path, route)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Match path against pattern (supports * wildcard and :param)
   */
  private matchPattern(path: string, pattern: string): boolean {
    // Convert pattern to regex
    let regexPattern = pattern
      .replace(/:[^/]+/g, '[^/]+')  // :param -> [^/]+
      .replace(/\*/g, '.*')          // * -> .*
      .replace(/\//g, '\\/');        // escape /

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  /**
   * Get cache statistics
   */
  public getStats(): Record<string, unknown> {
    if (!this.cache) {
      return {};
    }
    return this.cache.getStats() as unknown as Record<string, unknown>;
  }

  /**
   * Clear cache
   */
  public clearCache(): void {
    if (this.cache) {
      this.cache.clear();
      logger.info('Cache cleared');
    }
  }

  /**
   * Purge cache entries matching pattern
   */
  public purgeCache(pattern: RegExp): number {
    if (!this.cache) {
      return 0;
    }
    const purged = this.cache.purge(pattern);
    logger.info({ purged, pattern: pattern.source }, 'Cache purged');
    return purged;
  }
}

/**
 * Create cache plugin instance
 */
export function createCachePlugin(config?: Partial<CacheConfig>): CachePlugin {
  const plugin = new CachePlugin();
  if (config) {
    plugin.init(config as Record<string, unknown>);
  }
  return plugin;
}
