/**
 * Unit tests for Response Cache
 * Phase 5: Advanced Features - Response Caching
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ResponseCache, CachedResponse } from '../../src/core/response-cache.js';

describe('ResponseCache', () => {
  describe('Basic functionality', () => {
    it('should store and retrieve cached responses', () => {
      const cache = new ResponseCache();
      
      const response: CachedResponse = {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('test data'),
        cachedAt: Date.now(),
        ttl: 300,
        size: 9,
      };

      const key = cache.generateKey('GET', '/test', {});
      cache.set(key, response);

      const cached = cache.get(key);
      expect(cached).not.toBeNull();
      expect(cached?.statusCode).toBe(200);
      expect(cached?.body.toString()).toBe('test data');
    });

    it('should return null for non-existent keys', () => {
      const cache = new ResponseCache();
      const result = cache.get('non-existent-key');
      expect(result).toBeNull();
    });

    it('should check if key exists', () => {
      const cache = new ResponseCache();
      
      const response: CachedResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
        cachedAt: Date.now(),
        ttl: 300,
        size: 4,
      };

      const key = cache.generateKey('GET', '/test', {});
      cache.set(key, response);

      expect(cache.has(key)).toBe(true);
      expect(cache.has('other-key')).toBe(false);
    });

    it('should delete cached responses', () => {
      const cache = new ResponseCache();
      
      const response: CachedResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
        cachedAt: Date.now(),
        ttl: 300,
        size: 4,
      };

      const key = cache.generateKey('GET', '/test', {});
      cache.set(key, response);
      
      expect(cache.has(key)).toBe(true);
      cache.delete(key);
      expect(cache.has(key)).toBe(false);
    });

    it('should clear entire cache', () => {
      const cache = new ResponseCache();
      
      for (let i = 0; i < 5; i++) {
        const response: CachedResponse = {
          statusCode: 200,
          headers: {},
          body: Buffer.from(`test-${i}`),
          cachedAt: Date.now(),
          ttl: 300,
          size: 6,
        };
        const key = cache.generateKey('GET', `/test-${i}`, {});
        cache.set(key, response);
      }

      const stats1 = cache.getStats();
      expect(stats1.entries).toBe(5);

      cache.clear();

      const stats2 = cache.getStats();
      expect(stats2.entries).toBe(0);
    });
  });

  describe('Cache key generation', () => {
    it('should generate consistent keys for same inputs', () => {
      const cache = new ResponseCache();
      
      const key1 = cache.generateKey('GET', '/test', {});
      const key2 = cache.generateKey('GET', '/test', {});
      
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different methods', () => {
      const cache = new ResponseCache();
      
      const key1 = cache.generateKey('GET', '/test', {});
      const key2 = cache.generateKey('POST', '/test', {});
      
      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different URLs', () => {
      const cache = new ResponseCache();
      
      const key1 = cache.generateKey('GET', '/test1', {});
      const key2 = cache.generateKey('GET', '/test2', {});
      
      expect(key1).not.toBe(key2);
    });

    it('should include vary headers in key', () => {
      const cache = new ResponseCache();
      
      const key1 = cache.generateKey('GET', '/test', { accept: 'application/json' });
      const key2 = cache.generateKey('GET', '/test', { accept: 'text/html' });
      
      expect(key1).not.toBe(key2);
    });

    it('should handle array header values', () => {
      const cache = new ResponseCache();
      
      const key = cache.generateKey('GET', '/test', { 
        'accept-encoding': ['gzip', 'deflate'] 
      });
      
      expect(key).toBeTruthy();
      expect(typeof key).toBe('string');
    });
  });

  describe('TTL and expiration', () => {
    it('should expire entries after TTL', async () => {
      const cache = new ResponseCache();
      
      const response: CachedResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
        cachedAt: Date.now(),
        ttl: 0.1, // 100ms
        size: 4,
      };

      const key = cache.generateKey('GET', '/test', {});
      cache.set(key, response);

      // Should be cached
      expect(cache.get(key)).not.toBeNull();

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should be expired
      expect(cache.get(key)).toBeNull();
    });

    it('should not expire entries within TTL', async () => {
      const cache = new ResponseCache();
      
      const response: CachedResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
        cachedAt: Date.now(),
        ttl: 10, // 10 seconds
        size: 4,
      };

      const key = cache.generateKey('GET', '/test', {});
      cache.set(key, response);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(cache.get(key)).not.toBeNull();
    });
  });

  describe('Stale-while-revalidate', () => {
    it('should serve stale content within stale-while-revalidate period', async () => {
      const cache = new ResponseCache();
      
      const response: CachedResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
        cachedAt: Date.now(),
        ttl: 0.1, // 100ms
        staleWhileRevalidate: 1, // 1 second
        size: 4,
      };

      const key = cache.generateKey('GET', '/test', {});
      cache.set(key, response);

      // Wait for TTL to expire but within stale-while-revalidate
      await new Promise((resolve) => setTimeout(resolve, 150));

      const cached = cache.get(key);
      expect(cached).not.toBeNull();
    });

    it('should not serve content after stale-while-revalidate expires', async () => {
      const cache = new ResponseCache();
      
      const response: CachedResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
        cachedAt: Date.now(),
        ttl: 0.05, // 50ms
        staleWhileRevalidate: 0.1, // 100ms
        size: 4,
      };

      const key = cache.generateKey('GET', '/test', {});
      cache.set(key, response);

      // Wait for both TTL and stale-while-revalidate to expire
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(cache.get(key)).toBeNull();
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used entries when at max entries', () => {
      const cache = new ResponseCache({ maxEntries: 3, maxSize: 1024 * 1024 });
      
      const responses = ['key1', 'key2', 'key3', 'key4'].map((key) => ({
        key,
        response: {
          statusCode: 200,
          headers: {},
          body: Buffer.from(key),
          cachedAt: Date.now(),
          ttl: 300,
          size: key.length,
        } as CachedResponse,
      }));

      // Add 3 entries
      responses.slice(0, 3).forEach(({ key, response }) => {
        cache.set(key, response);
      });

      // Access key2 to make it more recent
      cache.get('key2');

      // Add 4th entry - should evict key1 (LRU)
      cache.set('key4', responses[3].response);

      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(true);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });

    it('should evict entries when exceeding max size', () => {
      const cache = new ResponseCache({ 
        maxEntries: 100, 
        maxSize: 100, // 100 bytes
      });
      
      // Create entries that total more than 100 bytes
      for (let i = 0; i < 5; i++) {
        const response: CachedResponse = {
          statusCode: 200,
          headers: {},
          body: Buffer.alloc(30), // 30 bytes each
          cachedAt: Date.now(),
          ttl: 300,
          size: 30,
        };
        cache.set(`key-${i}`, response);
      }

      const stats = cache.getStats();
      expect(stats.size).toBeLessThanOrEqual(100);
      expect(stats.entries).toBeLessThan(5);
    });

    it('should not cache responses larger than max size', () => {
      const cache = new ResponseCache({ maxSize: 100 });
      
      const largeResponse: CachedResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.alloc(200), // 200 bytes
        cachedAt: Date.now(),
        ttl: 300,
        size: 200,
      };

      const result = cache.set('large-key', largeResponse);
      expect(result).toBe(false);
      expect(cache.has('large-key')).toBe(false);
    });
  });

  describe('Purge functionality', () => {
    it('should purge entries matching pattern', () => {
      const cache = new ResponseCache();
      
      const urls = ['/api/users/1', '/api/users/2', '/api/posts/1', '/other'];
      const keys: string[] = [];
      
      urls.forEach((url) => {
        const response: CachedResponse = {
          statusCode: 200,
          headers: {},
          body: Buffer.from('test'),
          cachedAt: Date.now(),
          ttl: 300,
          size: 4,
        };
        const key = cache.generateKey('GET', url, {});
        keys.push(key);
        cache.set(key, response);
      });

      // Count entries before purge
      const statsBefore = cache.getStats();
      expect(statsBefore.entries).toBe(4);

      // Purge by matching first two keys directly (since keys are hashed)
      // In real usage, you'd need to maintain a mapping of URL patterns to keys
      const pattern = new RegExp(keys[0].substring(0, 10));
      const purged = cache.purge(pattern);
      
      // Should purge at least one entry
      const statsAfter = cache.getStats();
      expect(statsAfter.entries).toBeLessThan(statsBefore.entries);
    });

    it('should return 0 when no entries match pattern', () => {
      const cache = new ResponseCache();
      
      const response: CachedResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
        cachedAt: Date.now(),
        ttl: 300,
        size: 4,
      };
      cache.set('test-key', response);

      const purged = cache.purge(/nomatch/);
      expect(purged).toBe(0);
    });
  });

  describe('Cache statistics', () => {
    it('should track cache hits and misses', () => {
      const cache = new ResponseCache({ enableStats: true });
      
      const response: CachedResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
        cachedAt: Date.now(),
        ttl: 300,
        size: 4,
      };

      const key = cache.generateKey('GET', '/test', {});
      cache.set(key, response);

      // Generate hits and misses
      cache.get(key); // hit
      cache.get(key); // hit
      cache.get('other-key'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3, 2);
    });

    it('should track cache size and entries', () => {
      const cache = new ResponseCache();
      
      const response: CachedResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.alloc(100),
        cachedAt: Date.now(),
        ttl: 300,
        size: 100,
      };

      cache.set('key1', response);
      cache.set('key2', response);

      const stats = cache.getStats();
      expect(stats.entries).toBe(2);
      expect(stats.size).toBe(200);
    });

    it('should track evictions', () => {
      const cache = new ResponseCache({ maxEntries: 2, enableStats: true });
      
      for (let i = 0; i < 5; i++) {
        const response: CachedResponse = {
          statusCode: 200,
          headers: {},
          body: Buffer.from(`test-${i}`),
          cachedAt: Date.now(),
          ttl: 300,
          size: 6,
        };
        cache.set(`key-${i}`, response);
      }

      const stats = cache.getStats();
      expect(stats.evictions).toBeGreaterThan(0);
    });

    it('should reset statistics', () => {
      const cache = new ResponseCache({ enableStats: true });
      
      const response: CachedResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
        cachedAt: Date.now(),
        ttl: 300,
        size: 4,
      };

      cache.set('key', response);
      cache.get('key');
      cache.get('other-key');

      const stats1 = cache.getStats();
      expect(stats1.hits).toBeGreaterThan(0);

      cache.resetStats();

      const stats2 = cache.getStats();
      expect(stats2.hits).toBe(0);
      expect(stats2.misses).toBe(0);
    });
  });

  describe('Cache-Control parsing', () => {
    it('should parse max-age directive', () => {
      const cc = ResponseCache.parseCacheControl('max-age=3600');
      expect(cc.maxAge).toBe(3600);
    });

    it('should parse s-maxage directive', () => {
      const cc = ResponseCache.parseCacheControl('s-maxage=7200');
      expect(cc.sMaxAge).toBe(7200);
    });

    it('should parse no-cache directive', () => {
      const cc = ResponseCache.parseCacheControl('no-cache');
      expect(cc.noCache).toBe(true);
    });

    it('should parse no-store directive', () => {
      const cc = ResponseCache.parseCacheControl('no-store');
      expect(cc.noStore).toBe(true);
    });

    it('should parse private directive', () => {
      const cc = ResponseCache.parseCacheControl('private');
      expect(cc.private).toBe(true);
    });

    it('should parse public directive', () => {
      const cc = ResponseCache.parseCacheControl('public');
      expect(cc.public).toBe(true);
    });

    it('should parse must-revalidate directive', () => {
      const cc = ResponseCache.parseCacheControl('must-revalidate');
      expect(cc.mustRevalidate).toBe(true);
    });

    it('should parse stale-while-revalidate directive', () => {
      const cc = ResponseCache.parseCacheControl('stale-while-revalidate=60');
      expect(cc.staleWhileRevalidate).toBe(60);
    });

    it('should parse multiple directives', () => {
      const cc = ResponseCache.parseCacheControl('max-age=3600, public, must-revalidate');
      expect(cc.maxAge).toBe(3600);
      expect(cc.public).toBe(true);
      expect(cc.mustRevalidate).toBe(true);
    });

    it('should handle undefined cache-control', () => {
      const cc = ResponseCache.parseCacheControl(undefined);
      expect(cc.noCache).toBe(false);
      expect(cc.noStore).toBe(false);
    });
  });

  describe('Cacheability checks', () => {
    it('should allow caching GET requests with 200 status', () => {
      const cacheable = ResponseCache.isCacheable(
        200,
        { 'cache-control': 'max-age=3600' },
        'GET'
      );
      expect(cacheable).toBe(true);
    });

    it('should allow caching HEAD requests', () => {
      const cacheable = ResponseCache.isCacheable(
        200,
        { 'cache-control': 'max-age=3600' },
        'HEAD'
      );
      expect(cacheable).toBe(true);
    });

    it('should not cache POST requests', () => {
      const cacheable = ResponseCache.isCacheable(
        200,
        { 'cache-control': 'max-age=3600' },
        'POST'
      );
      expect(cacheable).toBe(false);
    });

    it('should not cache responses with no-store', () => {
      const cacheable = ResponseCache.isCacheable(
        200,
        { 'cache-control': 'no-store' },
        'GET'
      );
      expect(cacheable).toBe(false);
    });

    it('should not cache responses with private', () => {
      const cacheable = ResponseCache.isCacheable(
        200,
        { 'cache-control': 'private' },
        'GET'
      );
      expect(cacheable).toBe(false);
    });

    it('should not cache responses with no-cache', () => {
      const cacheable = ResponseCache.isCacheable(
        200,
        { 'cache-control': 'no-cache' },
        'GET'
      );
      expect(cacheable).toBe(false);
    });

    it('should not cache error responses', () => {
      const cacheable = ResponseCache.isCacheable(
        500,
        { 'cache-control': 'max-age=3600' },
        'GET'
      );
      expect(cacheable).toBe(false);
    });

    it('should not cache redirects', () => {
      const cacheable = ResponseCache.isCacheable(
        302,
        { 'cache-control': 'max-age=3600' },
        'GET'
      );
      expect(cacheable).toBe(false);
    });
  });

  describe('ETag generation', () => {
    it('should generate consistent ETags for same content', () => {
      const body = Buffer.from('test content');
      const etag1 = ResponseCache.generateETag(body);
      const etag2 = ResponseCache.generateETag(body);
      expect(etag1).toBe(etag2);
    });

    it('should generate different ETags for different content', () => {
      const body1 = Buffer.from('content 1');
      const body2 = Buffer.from('content 2');
      const etag1 = ResponseCache.generateETag(body1);
      const etag2 = ResponseCache.generateETag(body2);
      expect(etag1).not.toBe(etag2);
    });

    it('should generate quoted ETags', () => {
      const body = Buffer.from('test');
      const etag = ResponseCache.generateETag(body);
      expect(etag.startsWith('"')).toBe(true);
      expect(etag.endsWith('"')).toBe(true);
    });
  });

  describe('Conditional requests', () => {
    it('should match If-None-Match with ETag', () => {
      const response: CachedResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
        cachedAt: Date.now(),
        ttl: 300,
        etag: '"abc123"',
        size: 4,
      };

      const matches = ResponseCache.checkConditional(
        '"abc123"',
        undefined,
        response
      );
      expect(matches).toBe(true);
    });

    it('should match If-None-Match with multiple ETags', () => {
      const response: CachedResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
        cachedAt: Date.now(),
        ttl: 300,
        etag: '"abc123"',
        size: 4,
      };

      const matches = ResponseCache.checkConditional(
        '"xyz789", "abc123", "def456"',
        undefined,
        response
      );
      expect(matches).toBe(true);
    });

    it('should match If-None-Match with wildcard', () => {
      const response: CachedResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
        cachedAt: Date.now(),
        ttl: 300,
        etag: '"abc123"',
        size: 4,
      };

      const matches = ResponseCache.checkConditional(
        '*',
        undefined,
        response
      );
      expect(matches).toBe(true);
    });

    it('should not match different ETags', () => {
      const response: CachedResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
        cachedAt: Date.now(),
        ttl: 300,
        etag: '"abc123"',
        size: 4,
      };

      const matches = ResponseCache.checkConditional(
        '"xyz789"',
        undefined,
        response
      );
      expect(matches).toBe(false);
    });

    it('should match If-Modified-Since when not modified', () => {
      const lastModified = new Date('2024-01-01T00:00:00Z');
      const response: CachedResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
        cachedAt: Date.now(),
        ttl: 300,
        lastModified: lastModified.toUTCString(),
        size: 4,
      };

      const ifModifiedSince = new Date('2024-01-02T00:00:00Z').toUTCString();
      const matches = ResponseCache.checkConditional(
        undefined,
        ifModifiedSince,
        response
      );
      expect(matches).toBe(true);
    });

    it('should not match If-Modified-Since when modified', () => {
      const lastModified = new Date('2024-01-02T00:00:00Z');
      const response: CachedResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
        cachedAt: Date.now(),
        ttl: 300,
        lastModified: lastModified.toUTCString(),
        size: 4,
      };

      const ifModifiedSince = new Date('2024-01-01T00:00:00Z').toUTCString();
      const matches = ResponseCache.checkConditional(
        undefined,
        ifModifiedSince,
        response
      );
      expect(matches).toBe(false);
    });
  });

  describe('getTTL', () => {
    it('should use s-maxage if present', () => {
      const cache = new ResponseCache({ defaultTTL: 100 });
      const ttl = cache.getTTL({ 
        maxAge: 200, 
        sMaxAge: 300, 
        noCache: false, 
        noStore: false, 
        private: false,
        public: false,
        mustRevalidate: false,
      });
      expect(ttl).toBe(300);
    });

    it('should use max-age if s-maxage not present', () => {
      const cache = new ResponseCache({ defaultTTL: 100 });
      const ttl = cache.getTTL({ 
        maxAge: 200, 
        noCache: false, 
        noStore: false, 
        private: false,
        public: false,
        mustRevalidate: false,
      });
      expect(ttl).toBe(200);
    });

    it('should use default TTL if no directives', () => {
      const cache = new ResponseCache({ defaultTTL: 100 });
      const ttl = cache.getTTL({ 
        noCache: false, 
        noStore: false, 
        private: false,
        public: false,
        mustRevalidate: false,
      });
      expect(ttl).toBe(100);
    });
  });
});
