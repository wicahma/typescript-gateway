/**
 * Unit tests for Rate Limiter
 * Phase 5: Advanced Features - Rate Limiting
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenBucketRateLimiter, SlidingWindowRateLimiter } from '../../src/core/rate-limiter.js';

describe('TokenBucketRateLimiter', () => {
  describe('Basic functionality', () => {
    it('should allow requests within capacity', () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 10,
        refillRate: 5,
      });

      const result = limiter.consume('test-key', 1);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      expect(result.limit).toBe(10);
    });

    it('should reject requests exceeding capacity', () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 5,
        refillRate: 1,
      });

      // Consume all tokens
      for (let i = 0; i < 5; i++) {
        limiter.consume('test-key', 1);
      }

      // Next request should be rejected
      const result = limiter.consume('test-key', 1);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should track different keys independently', () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 3,
        refillRate: 1,
      });

      // Consume tokens for key1
      limiter.consume('key1', 2);
      const result1 = limiter.consume('key1', 1);
      expect(result1.remaining).toBe(0);

      // key2 should still have full capacity
      const result2 = limiter.consume('key2', 1);
      expect(result2.remaining).toBe(2);
    });

    it('should handle multiple token consumption', () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 10,
        refillRate: 5,
      });

      const result = limiter.consume('test-key', 5);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5);
    });

    it('should initialize new keys with full capacity', () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 100,
        refillRate: 10,
      });

      const result = limiter.consume('new-key', 10);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(90);
    });
  });

  describe('Token refill', () => {
    it('should refill tokens over time', async () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 10,
        refillRate: 10, // 10 tokens per second
      });

      // Consume all tokens
      limiter.consume('test-key', 10);
      const result1 = limiter.consume('test-key', 1);
      expect(result1.allowed).toBe(false);

      // Wait for 200ms (should refill ~2 tokens)
      await new Promise((resolve) => setTimeout(resolve, 200));

      const result2 = limiter.consume('test-key', 2);
      expect(result2.allowed).toBe(true);
    });

    it('should not exceed capacity when refilling', async () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 10,
        refillRate: 10,
      });

      // Consume 2 tokens
      limiter.consume('test-key', 2);

      // Wait long enough to refill more than capacity
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check should show full capacity, not more
      const result = limiter.check('test-key');
      expect(result.remaining).toBe(10);
    });

    it('should calculate correct reset time', () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 10,
        refillRate: 2, // 2 tokens per second
      });

      // Consume 8 tokens (2 remaining)
      limiter.consume('test-key', 8);
      
      const result = limiter.consume('test-key', 1);
      expect(result.allowed).toBe(true);
      
      // Should take 4 seconds to refill to full (8 tokens / 2 per second)
      expect(result.resetIn).toBeGreaterThan(0);
      expect(result.resetIn).toBeLessThanOrEqual(5);
    });
  });

  describe('Check without consuming', () => {
    it('should check rate limit without consuming tokens', () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 10,
        refillRate: 5,
      });

      limiter.consume('test-key', 5);
      
      const check1 = limiter.check('test-key');
      expect(check1.remaining).toBe(5);
      
      // Check again - should be the same
      const check2 = limiter.check('test-key');
      expect(check2.remaining).toBe(5);
    });

    it('should return full capacity for unknown keys', () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 20,
        refillRate: 5,
      });

      const result = limiter.check('unknown-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(20);
      expect(result.limit).toBe(20);
    });
  });

  describe('Reset and clear', () => {
    it('should reset rate limit for specific key', () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 10,
        refillRate: 5,
      });

      limiter.consume('test-key', 10);
      expect(limiter.check('test-key').remaining).toBe(0);

      limiter.reset('test-key');
      expect(limiter.check('test-key').remaining).toBe(10);
    });

    it('should clear all rate limits', () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 10,
        refillRate: 5,
      });

      limiter.consume('key1', 5);
      limiter.consume('key2', 7);
      
      limiter.clear();
      
      expect(limiter.check('key1').remaining).toBe(10);
      expect(limiter.check('key2').remaining).toBe(10);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used buckets when at capacity', () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 10,
        refillRate: 5,
        maxBuckets: 3,
      });

      // Create 3 buckets
      limiter.consume('key1', 1);
      limiter.consume('key2', 1);
      limiter.consume('key3', 1);

      // Access key2 to make it more recent
      limiter.consume('key2', 1);

      // Create 4th bucket - should evict key1 (LRU)
      limiter.consume('key4', 1);

      // key1 should be evicted (back to full capacity)
      expect(limiter.check('key1').remaining).toBe(10);
      
      // key2, key3, key4 should still exist
      expect(limiter.check('key2').remaining).toBeLessThan(10);
      expect(limiter.check('key3').remaining).toBeLessThan(10);
      expect(limiter.check('key4').remaining).toBeLessThan(10);
    });

    it('should track total buckets correctly', () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 10,
        refillRate: 5,
        maxBuckets: 100,
      });

      for (let i = 0; i < 50; i++) {
        limiter.consume(`key-${i}`, 1);
      }

      const stats = limiter.getStats();
      expect(stats.totalBuckets).toBe(50);
      expect(stats.maxBuckets).toBe(100);
    });
  });

  describe('Statistics', () => {
    it('should report accurate statistics', () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 10,
        refillRate: 5,
        maxBuckets: 1000,
      });

      limiter.consume('key1', 1);
      limiter.consume('key2', 1);
      limiter.consume('key3', 1);

      const stats = limiter.getStats();
      expect(stats.totalBuckets).toBe(3);
      expect(stats.maxBuckets).toBe(1000);
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });

    it('should estimate memory usage', () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 10,
        refillRate: 5,
        maxBuckets: 100000,
      });

      // Create 1000 buckets
      for (let i = 0; i < 1000; i++) {
        limiter.consume(`key-${i}`, 1);
      }

      const stats = limiter.getStats();
      // Each bucket should be roughly 124 bytes
      // 1000 buckets should be around 124KB
      expect(stats.memoryUsage).toBeGreaterThan(100000);
      expect(stats.memoryUsage).toBeLessThan(200000);
    });
  });

  describe('Edge cases', () => {
    it('should handle zero token consumption', () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 10,
        refillRate: 5,
      });

      const result = limiter.consume('test-key', 0);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10);
    });

    it('should handle consuming more tokens than capacity', () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 10,
        refillRate: 5,
      });

      const result = limiter.consume('test-key', 20);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(10); // Tokens not consumed since request rejected
    });

    it('should handle very small refill rates', async () => {
      const limiter = new TokenBucketRateLimiter({
        capacity: 10,
        refillRate: 0.5, // 1 token per 2 seconds
      });

      limiter.consume('test-key', 10);
      
      // Wait 50ms - should not refill any tokens (0.5 tokens/sec = 0.025 tokens in 50ms)
      await new Promise((resolve) => setTimeout(resolve, 50));
      
      const result = limiter.consume('test-key', 1);
      expect(result.allowed).toBe(false);
    });
  });
});

describe('SlidingWindowRateLimiter', () => {
  describe('Basic functionality', () => {
    it('should allow requests within limit', () => {
      const limiter = new SlidingWindowRateLimiter({
        windowMs: 60000, // 1 minute
        maxRequests: 10,
      });

      const result = limiter.consume('test-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      expect(result.limit).toBe(10);
    });

    it('should reject requests exceeding limit', () => {
      const limiter = new SlidingWindowRateLimiter({
        windowMs: 60000,
        maxRequests: 5,
      });

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        limiter.consume('test-key');
      }

      // 6th request should be rejected
      const result = limiter.consume('test-key');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should track different keys independently', () => {
      const limiter = new SlidingWindowRateLimiter({
        windowMs: 60000,
        maxRequests: 3,
      });

      limiter.consume('key1');
      limiter.consume('key1');
      const result1 = limiter.consume('key1');
      expect(result1.remaining).toBe(0);

      const result2 = limiter.consume('key2');
      expect(result2.remaining).toBe(2);
    });
  });

  describe('Sliding window behavior', () => {
    it('should expire old requests outside window', async () => {
      const limiter = new SlidingWindowRateLimiter({
        windowMs: 200, // 200ms window
        maxRequests: 5,
      });

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        limiter.consume('test-key');
      }

      // Should be at limit
      const result1 = limiter.consume('test-key');
      expect(result1.allowed).toBe(false);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Should be able to make requests again
      const result2 = limiter.consume('test-key');
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(4);
    });

    it('should calculate correct reset time', () => {
      const limiter = new SlidingWindowRateLimiter({
        windowMs: 60000,
        maxRequests: 5,
      });

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        limiter.consume('test-key');
      }

      const result = limiter.consume('test-key');
      expect(result.allowed).toBe(false);
      expect(result.resetIn).toBeGreaterThan(0);
      expect(result.resetIn).toBeLessThanOrEqual(60);
    });
  });

  describe('Check without consuming', () => {
    it('should check rate limit without consuming', () => {
      const limiter = new SlidingWindowRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      limiter.consume('test-key');
      limiter.consume('test-key');

      const check1 = limiter.check('test-key');
      expect(check1.remaining).toBe(8);

      // Check again - should be the same
      const check2 = limiter.check('test-key');
      expect(check2.remaining).toBe(8);
    });

    it('should return full limit for unknown keys', () => {
      const limiter = new SlidingWindowRateLimiter({
        windowMs: 60000,
        maxRequests: 20,
      });

      const result = limiter.check('unknown-key');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(20);
    });
  });

  describe('Reset and clear', () => {
    it('should reset rate limit for specific key', () => {
      const limiter = new SlidingWindowRateLimiter({
        windowMs: 60000,
        maxRequests: 5,
      });

      limiter.consume('test-key');
      limiter.consume('test-key');
      expect(limiter.check('test-key').remaining).toBe(3);

      limiter.reset('test-key');
      expect(limiter.check('test-key').remaining).toBe(5);
    });

    it('should clear all rate limits', () => {
      const limiter = new SlidingWindowRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      limiter.consume('key1');
      limiter.consume('key2');

      limiter.clear();

      expect(limiter.check('key1').remaining).toBe(10);
      expect(limiter.check('key2').remaining).toBe(10);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used windows when at capacity', () => {
      const limiter = new SlidingWindowRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        maxWindows: 3,
      });

      limiter.consume('key1');
      limiter.consume('key2');
      limiter.consume('key3');

      // Access key2 again
      limiter.consume('key2');

      // Create 4th window - should evict key1
      limiter.consume('key4');

      // key1 should be evicted (back to full limit)
      expect(limiter.check('key1').remaining).toBe(10);

      // Others should still exist
      expect(limiter.check('key2').remaining).toBeLessThan(10);
      expect(limiter.check('key3').remaining).toBeLessThan(10);
      expect(limiter.check('key4').remaining).toBeLessThan(10);
    });
  });

  describe('Statistics', () => {
    it('should report accurate statistics', () => {
      const limiter = new SlidingWindowRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        maxWindows: 1000,
      });

      limiter.consume('key1');
      limiter.consume('key2');
      limiter.consume('key3');

      const stats = limiter.getStats();
      expect(stats.totalWindows).toBe(3);
      expect(stats.maxWindows).toBe(1000);
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });

    it('should estimate memory usage correctly', () => {
      const limiter = new SlidingWindowRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        maxWindows: 100000,
      });

      for (let i = 0; i < 100; i++) {
        limiter.consume(`key-${i}`);
      }

      const stats = limiter.getStats();
      expect(stats.totalWindows).toBe(100);
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle very short windows', async () => {
      const limiter = new SlidingWindowRateLimiter({
        windowMs: 50, // 50ms window
        maxRequests: 3,
      });

      limiter.consume('test-key');
      limiter.consume('test-key');
      limiter.consume('test-key');

      const result1 = limiter.consume('test-key');
      expect(result1.allowed).toBe(false);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      const result2 = limiter.consume('test-key');
      expect(result2.allowed).toBe(true);
    });

    it('should handle single request limit', () => {
      const limiter = new SlidingWindowRateLimiter({
        windowMs: 1000,
        maxRequests: 1,
      });

      const result1 = limiter.consume('test-key');
      expect(result1.allowed).toBe(true);

      const result2 = limiter.consume('test-key');
      expect(result2.allowed).toBe(false);
    });
  });
});
