/**
 * Response Cache System
 * High-performance HTTP response caching with LRU eviction
 * Phase 5: Advanced Features
 */

import { createHash } from 'crypto';

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Maximum cache size in bytes */
  maxSize?: number;
  /** Maximum number of cache entries */
  maxEntries?: number;
  /** Default TTL in seconds */
  defaultTTL?: number;
  /** Enable cache statistics */
  enableStats?: boolean;
}

/**
 * Cached response entry
 */
export interface CachedResponse {
  /** Status code */
  statusCode: number;
  /** Response headers */
  headers: Record<string, string | string[]>;
  /** Response body */
  body: Buffer;
  /** Cache timestamp */
  cachedAt: number;
  /** Time-to-live in seconds */
  ttl: number;
  /** ETag for validation */
  etag?: string;
  /** Last-Modified timestamp */
  lastModified?: string;
  /** Size in bytes */
  size: number;
  /** Stale-while-revalidate duration in seconds */
  staleWhileRevalidate?: number;
}

/**
 * Cache entry with metadata
 */
interface CacheEntry {
  response: CachedResponse;
  lastAccess: number;
  hits: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  entries: number;
  size: number;
  maxSize: number;
  maxEntries: number;
  evictions: number;
}

/**
 * Cache control directives parsed from headers
 */
export interface CacheControl {
  maxAge?: number;
  sMaxAge?: number;
  noCache: boolean;
  noStore: boolean;
  private: boolean;
  public: boolean;
  mustRevalidate: boolean;
  staleWhileRevalidate?: number;
}

/**
 * Response Cache System
 * Implements LRU cache with TTL and HTTP caching semantics
 */
export class ResponseCache {
  private cache = new Map<string, CacheEntry>();
  private lruKeys: string[] = [];
  private config: Required<CacheConfig>;
  private currentSize = 0;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(config: CacheConfig = {}) {
    this.config = {
      maxSize: config.maxSize ?? 100 * 1024 * 1024, // 100 MB
      maxEntries: config.maxEntries ?? 10000,
      defaultTTL: config.defaultTTL ?? 300, // 5 minutes
      enableStats: config.enableStats ?? true,
    };
  }

  /**
   * Generate cache key from request details
   */
  public generateKey(
    method: string,
    url: string,
    varyHeaders?: Record<string, string | string[] | undefined>
  ): string {
    const parts = [method, url];

    if (varyHeaders) {
      const sorted = Object.keys(varyHeaders).sort();
      for (const key of sorted) {
        const value = varyHeaders[key];
        if (value) {
          parts.push(`${key}:${Array.isArray(value) ? value.join(',') : value}`);
        }
      }
    }

    return createHash('sha256').update(parts.join('|')).digest('hex');
  }

  /**
   * Store response in cache
   */
  public set(
    key: string,
    response: CachedResponse
  ): boolean {
    // Check if response is cacheable
    if (response.size > this.config.maxSize) {
      return false;
    }

    // Make room if needed
    while (
      this.cache.size >= this.config.maxEntries ||
      this.currentSize + response.size > this.config.maxSize
    ) {
      if (!this.evictLRU()) {
        return false; // Could not make room
      }
    }

    const entry: CacheEntry = {
      response,
      lastAccess: Date.now(),
      hits: 0,
    };

    // Remove old entry if exists
    const existingEntry = this.cache.get(key);
    if (existingEntry) {
      this.currentSize -= existingEntry.response.size;
    }

    this.cache.set(key, entry);
    this.currentSize += response.size;

    // Update LRU list
    this.updateLRU(key);

    return true;
  }

  /**
   * Get response from cache
   */
  public get(key: string): CachedResponse | null {
    const entry = this.cache.get(key);

    if (!entry) {
      if (this.config.enableStats) {
        this.stats.misses++;
      }
      return null;
    }

    const now = Date.now();
    const age = (now - entry.response.cachedAt) / 1000; // Convert to seconds

    // Check if expired
    if (age > entry.response.ttl) {
      // Check stale-while-revalidate
      if (entry.response.staleWhileRevalidate && 
          age <= entry.response.ttl + entry.response.staleWhileRevalidate) {
        // Return stale response (caller should revalidate in background)
        if (this.config.enableStats) {
          this.stats.hits++;
        }
        entry.hits++;
        entry.lastAccess = now;
        this.updateLRU(key);
        return entry.response;
      }

      // Expired, remove from cache
      this.delete(key);
      if (this.config.enableStats) {
        this.stats.misses++;
      }
      return null;
    }

    // Valid cache hit
    if (this.config.enableStats) {
      this.stats.hits++;
    }
    entry.hits++;
    entry.lastAccess = now;
    this.updateLRU(key);

    return entry.response;
  }

  /**
   * Check if response is in cache and fresh
   */
  public has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    const age = (Date.now() - entry.response.cachedAt) / 1000;
    return age <= entry.response.ttl;
  }

  /**
   * Delete entry from cache
   */
  public delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    this.currentSize -= entry.response.size;
    this.cache.delete(key);

    const index = this.lruKeys.indexOf(key);
    if (index > -1) {
      this.lruKeys.splice(index, 1);
    }

    return true;
  }

  /**
   * Clear entire cache
   */
  public clear(): void {
    this.cache.clear();
    this.lruKeys = [];
    this.currentSize = 0;
  }

  /**
   * Purge entries matching a pattern or tag
   */
  public purge(pattern: RegExp): number {
    let purged = 0;
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      if (this.delete(key)) {
        purged++;
      }
    }

    return purged;
  }

  /**
   * Get cache statistics
   */
  public getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      entries: this.cache.size,
      size: this.currentSize,
      maxSize: this.config.maxSize,
      maxEntries: this.config.maxEntries,
      evictions: this.stats.evictions,
    };
  }

  /**
   * Reset statistics
   */
  public resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
    };
  }

  /**
   * Parse Cache-Control header
   */
  public static parseCacheControl(header?: string): CacheControl {
    const result: CacheControl = {
      noCache: false,
      noStore: false,
      private: false,
      public: false,
      mustRevalidate: false,
    };

    if (!header) {
      return result;
    }

    const directives = header.split(',').map((d) => d.trim());

    for (const directive of directives) {
      const parts = directive.split('=');
      const key = parts[0]?.trim();
      const value = parts[1]?.trim();

      if (!key) {
        continue;
      }

      switch (key.toLowerCase()) {
        case 'max-age':
          if (value) {
            result.maxAge = parseInt(value, 10);
          }
          break;
        case 's-maxage':
          if (value) {
            result.sMaxAge = parseInt(value, 10);
          }
          break;
        case 'no-cache':
          result.noCache = true;
          break;
        case 'no-store':
          result.noStore = true;
          break;
        case 'private':
          result.private = true;
          break;
        case 'public':
          result.public = true;
          break;
        case 'must-revalidate':
          result.mustRevalidate = true;
          break;
        case 'stale-while-revalidate':
          if (value) {
            result.staleWhileRevalidate = parseInt(value, 10);
          }
          break;
      }
    }

    return result;
  }

  /**
   * Check if response is cacheable based on headers
   */
  public static isCacheable(
    statusCode: number,
    headers: Record<string, string | string[] | number | undefined>,
    method: string
  ): boolean {
    // Only cache GET and HEAD requests
    if (method !== 'GET' && method !== 'HEAD') {
      return false;
    }

    // Only cache successful responses
    if (statusCode < 200 || statusCode >= 300) {
      return false;
    }

    // Check Cache-Control directives
    const cacheControlValue = headers['cache-control'];
    const cacheControlHeader = Array.isArray(cacheControlValue) 
      ? cacheControlValue[0] 
      : typeof cacheControlValue === 'string' 
        ? cacheControlValue 
        : undefined;
    const cacheControl = this.parseCacheControl(cacheControlHeader);

    if (cacheControl.noStore || cacheControl.private) {
      return false;
    }

    // If no-cache, require revalidation
    if (cacheControl.noCache) {
      return false;
    }

    return true;
  }

  /**
   * Generate ETag from response body
   */
  public static generateETag(body: Buffer): string {
    const hash = createHash('md5').update(body).digest('hex');
    return `"${hash}"`;
  }

  /**
   * Check if conditional request matches cached response
   */
  public static checkConditional(
    ifNoneMatch?: string,
    ifModifiedSince?: string,
    cachedResponse?: CachedResponse
  ): boolean {
    if (!cachedResponse) {
      return false;
    }

    // Check If-None-Match (ETag)
    if (ifNoneMatch && cachedResponse.etag) {
      const etags = ifNoneMatch.split(',').map((e) => e.trim());
      if (etags.includes(cachedResponse.etag) || etags.includes('*')) {
        return true;
      }
    }

    // Check If-Modified-Since
    if (ifModifiedSince && cachedResponse.lastModified) {
      const ifModifiedDate = new Date(ifModifiedSince);
      const lastModifiedDate = new Date(cachedResponse.lastModified);
      if (lastModifiedDate <= ifModifiedDate) {
        return true;
      }
    }

    return false;
  }

  /**
   * Update LRU list
   */
  private updateLRU(key: string): void {
    const index = this.lruKeys.indexOf(key);
    if (index > -1) {
      this.lruKeys.splice(index, 1);
    }
    this.lruKeys.push(key);
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): boolean {
    if (this.lruKeys.length === 0) {
      // Fallback: find oldest by lastAccess
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [key, entry] of this.cache.entries()) {
        if (entry.lastAccess < oldestTime) {
          oldestTime = entry.lastAccess;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.delete(oldestKey);
        if (this.config.enableStats) {
          this.stats.evictions++;
        }
        return true;
      }
      return false;
    }

    const keyToEvict = this.lruKeys.shift();
    if (keyToEvict) {
      this.delete(keyToEvict);
      if (this.config.enableStats) {
        this.stats.evictions++;
      }
      return true;
    }

    return false;
  }

  /**
   * Get TTL from cache control or use default
   */
  public getTTL(cacheControl: CacheControl): number {
    if (cacheControl.sMaxAge !== undefined) {
      return cacheControl.sMaxAge;
    }
    if (cacheControl.maxAge !== undefined) {
      return cacheControl.maxAge;
    }
    return this.config.defaultTTL;
  }
}
