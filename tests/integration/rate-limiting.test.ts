/**
 * Integration tests for Rate Limiting
 * Phase 5: Advanced Features
 * 
 * These tests verify rate limiting plugin integration with request contexts
 */

import { describe, it, expect } from 'vitest';
import { createRateLimitPlugin } from '../../src/plugins/builtin/rate-limit-plugin.js';
import { RequestContext, HttpMethod } from '../../src/types/core.js';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';

// Helper to create mock context
function createMockContext(path: string, ip: string, headers?: Record<string, string>): RequestContext {
  const mockSocket = {
    remoteAddress: ip,
  } as Socket;

  const mockReq = {
    socket: mockSocket,
  } as IncomingMessage;

  const mockRes = {
    statusCode: 200,
    _headers: {} as Record<string, string | number | string[] | undefined>,
    setHeader: function (name: string, value: string | number | readonly string[]): this {
      this._headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader: function (name: string): string | number | string[] | undefined {
      return this._headers[name.toLowerCase()];
    },
    end: function (data?: any): this {
      this.ended = true;
      this.endData = data;
      return this;
    },
    ended: false,
    endData: undefined,
  } as unknown as ServerResponse;

  return {
    requestId: `req-${Date.now()}`,
    startTime: process.hrtime.bigint(),
    method: 'GET' as HttpMethod,
    path,
    query: null,
    params: {},
    headers: headers || {},
    body: null,
    req: mockReq,
    res: mockRes,
    upstream: null,
    state: {},
    responded: false,
    route: null,
    timestamps: {},
  };
}

describe('Rate Limiting Integration Tests', () => {
  describe('Per-IP rate limiting', () => {
    it('should initialize and apply per-IP rate limiting', async () => {
      const plugin = createRateLimitPlugin({
        enabled: true,
        strategies: [
          {
            name: 'per-ip',
            type: 'token-bucket',
            capacity: 3,
            refillRate: 1,
            keyExtractor: 'ip',
          },
        ],
      });

      // Make 3 requests from same IP
      for (let i = 0; i < 3; i++) {
        const ctx = createMockContext('/test', '192.168.1.1');
        await plugin.preRoute?.(ctx);
        expect(ctx.responded).toBe(false);
      }

      // 4th request should be blocked
      const ctx = createMockContext('/test', '192.168.1.1');
      await plugin.preRoute?.(ctx);
      expect(ctx.responded).toBe(true);
      expect(ctx.res.statusCode).toBe(429);
    });

    it('should track different IPs independently', async () => {
      const plugin = createRateLimitPlugin({
        enabled: true,
        strategies: [
          {
            name: 'per-ip',
            type: 'token-bucket',
            capacity: 2,
            refillRate: 1,
            keyExtractor: 'ip',
          },
        ],
      });

      // Exhaust limit for IP1
      for (let i = 0; i < 2; i++) {
        const ctx = createMockContext('/test', '192.168.1.1');
        await plugin.preRoute?.(ctx);
      }

      // IP1 should be blocked
      const ctx1 = createMockContext('/test', '192.168.1.1');
      await plugin.preRoute?.(ctx1);
      expect(ctx1.responded).toBe(true);

      // IP2 should still work
      const ctx2 = createMockContext('/test', '192.168.1.2');
      await plugin.preRoute?.(ctx2);
      expect(ctx2.responded).toBe(false);
    });
  });

  describe('Per-header rate limiting', () => {
    it('should rate limit by custom header', async () => {
      const plugin = createRateLimitPlugin({
        enabled: true,
        strategies: [
          {
            name: 'per-api-key',
            type: 'token-bucket',
            capacity: 2,
            refillRate: 1,
            keyExtractor: 'header',
            headerName: 'x-api-key',
          },
        ],
      });

      // Make 2 requests with same API key
      for (let i = 0; i < 2; i++) {
        const ctx = createMockContext('/api', '192.168.1.1', { 'x-api-key': 'key123' });
        await plugin.preRoute?.(ctx);
        expect(ctx.responded).toBe(false);
      }

      // 3rd request should be blocked
      const ctx = createMockContext('/api', '192.168.1.1', { 'x-api-key': 'key123' });
      await plugin.preRoute?.(ctx);
      expect(ctx.responded).toBe(true);
      expect(ctx.res.statusCode).toBe(429);
    });

    it('should track different API keys independently', async () => {
      const plugin = createRateLimitPlugin({
        enabled: true,
        strategies: [
          {
            name: 'per-api-key',
            type: 'token-bucket',
            capacity: 1,
            refillRate: 1,
            keyExtractor: 'header',
            headerName: 'x-api-key',
          },
        ],
      });

      // Exhaust key1
      const ctx1 = createMockContext('/api', '192.168.1.1', { 'x-api-key': 'key1' });
      await plugin.preRoute?.(ctx1);

      // key1 should be blocked
      const ctx2 = createMockContext('/api', '192.168.1.1', { 'x-api-key': 'key1' });
      await plugin.preRoute?.(ctx2);
      expect(ctx2.responded).toBe(true);

      // key2 should work
      const ctx3 = createMockContext('/api', '192.168.1.1', { 'x-api-key': 'key2' });
      await plugin.preRoute?.(ctx3);
      expect(ctx3.responded).toBe(false);
    });
  });

  describe('Sliding window rate limiting', () => {
    it('should apply sliding window algorithm', async () => {
      const plugin = createRateLimitPlugin({
        enabled: true,
        strategies: [
          {
            name: 'sliding',
            type: 'sliding-window',
            windowMs: 1000,
            maxRequests: 3,
            keyExtractor: 'ip',
          },
        ],
      });

      // Make 3 requests
      for (let i = 0; i < 3; i++) {
        const ctx = createMockContext('/test', '192.168.1.1');
        await plugin.preRoute?.(ctx);
        expect(ctx.responded).toBe(false);
      }

      // 4th request should be blocked
      const ctx = createMockContext('/test', '192.168.1.1');
      await plugin.preRoute?.(ctx);
      expect(ctx.responded).toBe(true);
    });

    it('should reset after window expires', async () => {
      const plugin = createRateLimitPlugin({
        enabled: true,
        strategies: [
          {
            name: 'sliding',
            type: 'sliding-window',
            windowMs: 200,
            maxRequests: 2,
            keyExtractor: 'ip',
          },
        ],
      });

      // Make 2 requests
      for (let i = 0; i < 2; i++) {
        const ctx = createMockContext('/test', '192.168.1.1');
        await plugin.preRoute?.(ctx);
      }

      // 3rd should be blocked
      const ctx1 = createMockContext('/test', '192.168.1.1');
      await plugin.preRoute?.(ctx1);
      expect(ctx1.responded).toBe(true);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Should work again
      const ctx2 = createMockContext('/test', '192.168.1.1');
      await plugin.preRoute?.(ctx2);
      expect(ctx2.responded).toBe(false);
    });
  });

  describe('Route filtering', () => {
    it('should only apply to matching routes', async () => {
      const plugin = createRateLimitPlugin({
        enabled: true,
        strategies: [
          {
            name: 'api-only',
            type: 'token-bucket',
            capacity: 1,
            refillRate: 1,
            keyExtractor: 'ip',
            routes: ['/api/*'],
          },
        ],
      });

      // Exhaust limit for /api
      const ctx1 = createMockContext('/api/users', '192.168.1.1');
      await plugin.preRoute?.(ctx1);

      // /api should be blocked
      const ctx2 = createMockContext('/api/posts', '192.168.1.1');
      await plugin.preRoute?.(ctx2);
      expect(ctx2.responded).toBe(true);

      // /public should not be limited
      const ctx3 = createMockContext('/public', '192.168.1.1');
      await plugin.preRoute?.(ctx3);
      expect(ctx3.responded).toBe(false);
    });
  });

  describe('Rate limit headers', () => {
    it('should include rate limit headers', async () => {
      const plugin = createRateLimitPlugin({
        enabled: true,
        includeHeaders: true,
        strategies: [
          {
            name: 'per-ip',
            type: 'token-bucket',
            capacity: 10,
            refillRate: 5,
            keyExtractor: 'ip',
          },
        ],
      });

      const ctx = createMockContext('/test', '192.168.1.1');
      await plugin.preRoute?.(ctx);

      expect(ctx.res.getHeader('x-ratelimit-limit')).toBe('10');
      expect(ctx.res.getHeader('x-ratelimit-remaining')).toBe('9');
      expect(ctx.res.getHeader('x-ratelimit-reset')).toBeDefined();
    });

    it('should include retry-after header when rate limited', async () => {
      const plugin = createRateLimitPlugin({
        enabled: true,
        strategies: [
          {
            name: 'per-ip',
            type: 'token-bucket',
            capacity: 1,
            refillRate: 1,
            keyExtractor: 'ip',
          },
        ],
      });

      // Exhaust limit
      const ctx1 = createMockContext('/test', '192.168.1.1');
      await plugin.preRoute?.(ctx1);

      // Should be blocked with retry-after
      const ctx2 = createMockContext('/test', '192.168.1.1');
      await plugin.preRoute?.(ctx2);
      expect(ctx2.responded).toBe(true);
      expect(ctx2.res.getHeader('retry-after')).toBeDefined();
    });
  });

  describe('Multiple strategies', () => {
    it('should apply first matching strategy that blocks', async () => {
      const plugin = createRateLimitPlugin({
        enabled: true,
        strategies: [
          {
            name: 'global',
            type: 'token-bucket',
            capacity: 10,
            refillRate: 5,
            keyExtractor: 'ip',
          },
          {
            name: 'strict',
            type: 'token-bucket',
            capacity: 1,
            refillRate: 1,
            keyExtractor: 'ip',
            routes: ['/api/strict/*'],
          },
        ],
      });

      // First request to strict endpoint - allowed
      const ctx1 = createMockContext('/api/strict/endpoint', '192.168.1.1');
      await plugin.preRoute?.(ctx1);
      expect(ctx1.responded).toBe(false);

      // Second request - blocked by strict strategy (capacity: 1)
      const ctx2 = createMockContext('/api/strict/endpoint', '192.168.1.1');
      await plugin.preRoute?.(ctx2);
      expect(ctx2.responded).toBe(true);
      expect(ctx2.res.statusCode).toBe(429);
    });
  });

  describe('Plugin statistics', () => {
    it('should provide statistics', async () => {
      const plugin = createRateLimitPlugin({
        enabled: true,
        strategies: [
          {
            name: 'test',
            type: 'token-bucket',
            capacity: 10,
            refillRate: 5,
            keyExtractor: 'ip',
          },
        ],
      });

      // Make some requests
      for (let i = 0; i < 5; i++) {
        const ctx = createMockContext('/test', `192.168.1.${i}`);
        await plugin.preRoute?.(ctx);
      }

      const stats = plugin.getStats();
      expect(stats).toBeDefined();
      expect(stats['test']).toBeDefined();
      expect(stats['test']).toHaveProperty('totalBuckets');
    });
  });
});
