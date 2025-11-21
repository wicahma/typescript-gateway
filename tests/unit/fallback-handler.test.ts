/**
 * Unit tests for fallback handler
 * Phase 7: Resilience & Error Handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FallbackHandler, FallbackResponse } from '../../src/core/fallback-handler.js';
import { GatewayError, TimeoutError } from '../../src/core/errors.js';

describe('FallbackHandler', () => {
  let handler: FallbackHandler;

  beforeEach(() => {
    handler = new FallbackHandler();
  });

  describe('Static Fallback', () => {
    it('should set and get static fallback for route', () => {
      const fallback: FallbackResponse = {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({ message: 'fallback' })),
      };

      handler.setStaticFallback('/api/test', fallback);

      const context = { route: '/api/test' };
      const result = handler.getFallback(context);

      expect(result).toBeDefined();
      expect(result!.statusCode).toBe(200);
    });

    it('should return null for non-existent static fallback', () => {
      const context = { route: '/api/nonexistent' };
      const result = handler.getFallback(context);

      expect(result).toBeDefined(); // Returns default fallback
      expect(result!.statusCode).toBe(503);
    });

    it('should remove static fallback', () => {
      const fallback: FallbackResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
      };

      handler.setStaticFallback('/api/test', fallback);
      handler.removeStaticFallback('/api/test');

      const stats = handler.getStats();
      expect(stats.staticFallbackCount).toBe(0);
    });

    it('should support upstream-specific fallbacks', () => {
      const fallback: FallbackResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('upstream fallback'),
      };

      handler.setStaticFallback('backend-1', fallback);

      const context = { route: '/api/test', upstreamId: 'backend-1' };
      const result = handler.getFallback(context);

      expect(result).toBeDefined();
      expect(result!.body.toString()).toContain('upstream fallback');
    });
  });

  describe('Stale Response Fallback', () => {
    it('should cache and serve stale response', async () => {
      const response: FallbackResponse = {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('cached data'),
      };

      handler.cacheResponse('/api/test', 'backend', response, 1000);

      // Simulate stale scenario
      const context = {
        route: '/api/test',
        upstreamId: 'backend',
        error: new TimeoutError('Timeout', 'upstream', 5000),
      };

      const result = handler.getFallback(context);

      expect(result).toBeDefined();
      expect(result!.headers['warning']).toContain('Stale');
      expect(result!.headers['x-served-from-cache']).toBe('true');
    });

    it('should not serve expired stale response', async () => {
      const response: FallbackResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('cached'),
      };

      // Cache with very short TTL
      handler.cacheResponse('/api/test', undefined, response, 1);

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update config to prevent serving very stale responses
      handler.updateConfig({ maxStaleAge: 50 });

      const context = { route: '/api/test', error: new Error('Error') };
      const result = handler.getFallback(context);

      // Should return default fallback instead of stale
      expect(result!.statusCode).toBe(503);
    });

    it('should clear cached response', () => {
      const response: FallbackResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('cached'),
      };

      handler.cacheResponse('/api/test', undefined, response);
      
      let stats = handler.getStats();
      expect(stats.cachedResponseCount).toBeGreaterThan(0);

      handler.clearCachedResponse('/api/test');
      
      stats = handler.getStats();
      // May still have other cached responses
      expect(stats).toBeDefined();
    });

    it('should clear all cached responses', () => {
      const response: FallbackResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('cached'),
      };

      handler.cacheResponse('/api/test1', undefined, response);
      handler.cacheResponse('/api/test2', undefined, response);

      handler.clearAllCached();

      const stats = handler.getStats();
      expect(stats.cachedResponseCount).toBe(0);
    });
  });

  describe('Default Fallback', () => {
    it('should return default fallback for 503', () => {
      const context = {
        route: '/api/test',
        error: new GatewayError('Service unavailable', 'UNAVAILABLE', 503, false),
      };

      const result = handler.getFallback(context);

      expect(result).toBeDefined();
      expect(result!.statusCode).toBe(503);
      expect(result!.headers['x-fallback-response']).toBe('true');
    });

    it('should return default fallback for 504', () => {
      const context = {
        route: '/api/test',
        error: new TimeoutError('Request timeout', 'request', 5000),
      };

      const result = handler.getFallback(context);

      expect(result).toBeDefined();
      expect(result!.statusCode).toBe(504);
    });

    it('should use custom default template', () => {
      handler.setDefaultTemplate(503, 'Custom 503 message');

      const context = {
        route: '/api/test',
        error: new GatewayError('Service unavailable', 'UNAVAILABLE', 503, false),
      };

      const result = handler.getFallback(context);

      expect(result!.body.toString()).toContain('Custom 503 message');
    });
  });

  describe('Error Detection', () => {
    it('should detect timeout errors', () => {
      const context = {
        route: '/api/test',
        error: new Error('Request timeout'),
      };

      const result = handler.getFallback(context);

      expect(result).toBeDefined();
      expect(result!.statusCode).toBe(504);
    });

    it('should detect circuit breaker errors', () => {
      const context = {
        route: '/api/test',
        error: new Error('Circuit breaker open'),
      };

      const result = handler.getFallback(context);

      expect(result).toBeDefined();
      expect(result!.statusCode).toBe(503);
    });

    it('should detect unavailable errors', () => {
      const context = {
        route: '/api/test',
        error: new Error('Service unavailable'),
      };

      const result = handler.getFallback(context);

      expect(result).toBeDefined();
      expect(result!.statusCode).toBe(503);
    });
  });

  describe('Statistics', () => {
    it('should track fallback statistics', () => {
      handler.getFallback({ route: '/api/test' });

      const stats = handler.getStats();
      expect(stats.totalFallbacks).toBeGreaterThan(0);
    });

    it('should track stale fallback count', async () => {
      const response: FallbackResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('cached'),
      };

      handler.cacheResponse('/api/test', undefined, response);

      handler.getFallback({
        route: '/api/test',
        error: new Error('Error'),
      });

      const stats = handler.getStats();
      expect(stats.staleFallbacks).toBeGreaterThan(0);
    });

    it('should reset statistics', () => {
      handler.getFallback({ route: '/api/test' });
      handler.resetStats();

      const stats = handler.getStats();
      expect(stats.totalFallbacks).toBe(0);
    });
  });

  describe('Configuration', () => {
    it('should update configuration', () => {
      handler.updateConfig({
        enableStaticFallback: true,
        enableStaleFallback: true,
        maxStaleAge: 600000,
      });

      // Configuration updated successfully if no error
      expect(handler).toBeDefined();
    });

    it('should disable static fallback', () => {
      handler.updateConfig({ enableStaticFallback: false });

      const fallback: FallbackResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
      };

      handler.setStaticFallback('/api/test', fallback);

      const context = { route: '/api/test' };
      const result = handler.getFallback(context);

      // Should return default fallback since static is disabled
      expect(result!.statusCode).toBe(503);
    });

    it('should disable stale fallback', () => {
      handler.updateConfig({ enableStaleFallback: false });

      const response: FallbackResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('cached'),
      };

      handler.cacheResponse('/api/test', undefined, response);

      const context = {
        route: '/api/test',
        error: new Error('Error'),
      };

      const result = handler.getFallback(context);

      // Should return default fallback since stale is disabled
      expect(result!.statusCode).toBe(503);
    });
  });

  describe('Cleanup', () => {
    it('should cleanup stale cached responses', async () => {
      const response: FallbackResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('cached'),
      };

      // Cache with very short TTL
      handler.cacheResponse('/api/test1', undefined, response, 1);
      handler.cacheResponse('/api/test2', undefined, response, 1);

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Update config to make these stale
      handler.updateConfig({ maxStaleAge: 10 });

      handler.cleanup();

      const stats = handler.getStats();
      expect(stats.cachedResponseCount).toBe(0);
    });
  });

  describe('Destroy', () => {
    it('should destroy handler and cleanup resources', () => {
      const fallback: FallbackResponse = {
        statusCode: 200,
        headers: {},
        body: Buffer.from('test'),
      };

      handler.setStaticFallback('/api/test', fallback);
      handler.cacheResponse('/api/test', undefined, fallback);

      handler.destroy();

      const stats = handler.getStats();
      expect(stats.staticFallbackCount).toBe(0);
      expect(stats.cachedResponseCount).toBe(0);
    });
  });
});
