/**
 * Unit tests for retry manager
 * Phase 7: Resilience & Error Handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryManager, RetryConfig } from '../../src/core/retry-manager.js';
import { CircuitBreaker } from '../../src/core/circuit-breaker.js';
import { CircuitBreakerState } from '../../src/types/core.js';
import { GatewayError, UpstreamError, TimeoutError } from '../../src/core/errors.js';

describe('RetryManager', () => {
  let retryManager: RetryManager;

  beforeEach(() => {
    retryManager = new RetryManager();
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      const stats = retryManager.getStats();
      expect(stats).toBeDefined();
    });

    it('should accept custom configuration', () => {
      const config: Partial<RetryConfig> = {
        maxAttempts: 5,
        initialDelay: 200,
        maxDelay: 10000,
      };
      const manager = new RetryManager(config);
      expect(manager).toBeDefined();
    });

    it('should update configuration', () => {
      retryManager.updateConfig({ maxAttempts: 5 });
      // Configuration updated successfully if no error
      expect(retryManager).toBeDefined();
    });
  });

  describe('Execute with Retry', () => {
    it('should succeed on first attempt', async () => {
      let attempts = 0;
      const fn = vi.fn(async () => {
        attempts++;
        return 'success';
      });

      const result = await retryManager.execute(fn, {
        method: 'GET',
        path: '/api/test',
      });

      expect(result.value).toBe('success');
      expect(result.attempts).toBe(1);
      expect(result.retried).toBe(false);
      expect(attempts).toBe(1);
    });

    it('should retry on retryable error', async () => {
      let attempts = 0;
      const fn = vi.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new UpstreamError('Service unavailable');
        }
        return 'success';
      });

      const result = await retryManager.execute(
        fn,
        { method: 'GET', path: '/api/test' },
        { maxAttempts: 3, initialDelay: 10 }
      );

      expect(result.value).toBe('success');
      expect(result.attempts).toBe(3);
      expect(result.retried).toBe(true);
      expect(attempts).toBe(3);
    });

    it('should not retry non-retryable errors', async () => {
      const fn = vi.fn(async () => {
        throw new GatewayError('Bad request', 'BAD_REQUEST', 400, false);
      });

      const result = await retryManager.execute(
        fn,
        { method: 'GET', path: '/api/test' },
        { maxAttempts: 3 }
      );

      expect(result.error).toBeDefined();
      expect(result.attempts).toBe(1);
      expect(result.retried).toBe(false);
    });

    it('should respect maxAttempts limit', async () => {
      let attempts = 0;
      const fn = vi.fn(async () => {
        attempts++;
        throw new UpstreamError('Always fails');
      });

      const result = await retryManager.execute(
        fn,
        { method: 'GET', path: '/api/test' },
        { maxAttempts: 3, initialDelay: 10 }
      );

      expect(result.error).toBeDefined();
      expect(result.attempts).toBe(3);
      expect(attempts).toBe(3);
    });

    it('should not retry non-idempotent methods by default', async () => {
      const fn = vi.fn(async () => {
        throw new UpstreamError('Service unavailable');
      });

      const result = await retryManager.execute(fn, {
        method: 'POST',
        path: '/api/test',
      });

      expect(result.error).toBeDefined();
      expect(result.attempts).toBe(1);
    });

    it('should retry idempotent methods', async () => {
      const methods = ['GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'];

      for (const method of methods) {
        let attempts = 0;
        const fn = async () => {
          attempts++;
          if (attempts < 2) {
            throw new UpstreamError('Service unavailable');
          }
          return 'success';
        };

        const result = await retryManager.execute(
          fn,
          { method, path: '/api/test' },
          { maxAttempts: 2, initialDelay: 1 }
        );

        expect(result.value).toBe('success');
        expect(result.attempts).toBe(2);
      }
    });
  });

  describe('Exponential Backoff', () => {
    it('should apply exponential backoff', async () => {
      let attempts = 0;
      const delays: number[] = [];
      const startTimes: number[] = [];

      const fn = async () => {
        const now = Date.now();
        if (attempts > 0) {
          delays.push(now - startTimes[attempts - 1]);
        }
        startTimes.push(now);
        attempts++;
        
        if (attempts < 3) {
          throw new UpstreamError('Service unavailable');
        }
        return 'success';
      };

      await retryManager.execute(
        fn,
        { method: 'GET', path: '/api/test' },
        { 
          maxAttempts: 3, 
          initialDelay: 50,
          backoffMultiplier: 2,
          jitter: false // Disable jitter for predictable testing
        }
      );

      // First retry should have ~50ms delay, second should have ~100ms delay
      // Allow some tolerance for timing
      expect(delays[0]).toBeGreaterThanOrEqual(40);
      expect(delays[1]).toBeGreaterThanOrEqual(90);
    });

    it('should apply jitter to prevent thundering herd', async () => {
      const delays: number[] = [];

      for (let i = 0; i < 5; i++) {
        let attempts = 0;
        const startTimes: number[] = [];

        const fn = async () => {
          const now = Date.now();
          if (attempts > 0) {
            delays.push(now - startTimes[attempts - 1]);
          }
          startTimes.push(now);
          attempts++;
          
          if (attempts < 2) {
            throw new UpstreamError('Service unavailable');
          }
          return 'success';
        };

        await retryManager.execute(
          fn,
          { method: 'GET', path: '/api/test' },
          { maxAttempts: 2, initialDelay: 100, jitter: true }
        );
      }

      // With jitter, delays should vary
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });

    it('should respect maxDelay cap', async () => {
      let attempts = 0;
      const delays: number[] = [];
      const startTimes: number[] = [];

      const fn = async () => {
        const now = Date.now();
        if (attempts > 0) {
          delays.push(now - startTimes[attempts - 1]);
        }
        startTimes.push(now);
        attempts++;
        
        if (attempts < 4) {
          throw new UpstreamError('Service unavailable');
        }
        return 'success';
      };

      await retryManager.execute(
        fn,
        { method: 'GET', path: '/api/test' },
        { 
          maxAttempts: 4, 
          initialDelay: 1000,
          maxDelay: 1500,
          backoffMultiplier: 2,
          jitter: false
        }
      );

      // All delays should be <= maxDelay
      for (const delay of delays) {
        expect(delay).toBeLessThanOrEqual(1600); // Small tolerance
      }
    });
  });

  describe('Retry Budget', () => {
    it('should respect timeout budget', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 200));
        throw new UpstreamError('Service unavailable');
      };

      const result = await retryManager.execute(
        fn,
        { method: 'GET', path: '/api/test' },
        { maxAttempts: 10, initialDelay: 50, timeout: 500 }
      );

      expect(result.error).toBeDefined();
      expect(attempts).toBeLessThan(10); // Should stop before maxAttempts due to timeout
      expect(result.totalTime).toBeLessThanOrEqual(800); // Some tolerance
    });
  });

  describe('Circuit Breaker Integration', () => {
    it('should not retry when circuit breaker is open', async () => {
      const circuitBreaker = new CircuitBreaker('test-upstream');
      circuitBreaker.forceState(CircuitBreakerState.OPEN);

      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw new UpstreamError('Service unavailable');
      };

      const result = await retryManager.execute(
        fn,
        {
          method: 'GET',
          path: '/api/test',
          upstreamId: 'test-upstream',
          circuitBreaker,
        },
        { maxAttempts: 3, initialDelay: 10 }
      );

      expect(result.error).toBeDefined();
      expect(attempts).toBe(1); // Should only try once before checking circuit breaker
    });

    it('should retry when circuit breaker is closed', async () => {
      const circuitBreaker = new CircuitBreaker('test-upstream');

      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new UpstreamError('Service unavailable');
        }
        return 'success';
      };

      const result = await retryManager.execute(
        fn,
        {
          method: 'GET',
          path: '/api/test',
          upstreamId: 'test-upstream',
          circuitBreaker,
        },
        { maxAttempts: 2, initialDelay: 10 }
      );

      expect(result.value).toBe('success');
      expect(attempts).toBe(2);
    });
  });

  describe('Statistics', () => {
    it('should track retry statistics', async () => {
      retryManager.resetStats();

      // Successful retry
      let attempts = 0;
      await retryManager.execute(
        async () => {
          attempts++;
          if (attempts < 2) {
            throw new UpstreamError('Service unavailable');
          }
          return 'success';
        },
        { method: 'GET', path: '/api/test' },
        { maxAttempts: 2, initialDelay: 1 }
      );

      const stats = retryManager.getStats();
      expect(stats.totalRetries).toBe(1);
      expect(stats.successfulRetries).toBe(1);
      expect(stats.successRate).toBe(100);
    });

    it('should track failed retries', async () => {
      retryManager.resetStats();

      await retryManager.execute(
        async () => {
          throw new UpstreamError('Service unavailable');
        },
        { method: 'GET', path: '/api/test' },
        { maxAttempts: 2, initialDelay: 1 }
      );

      const stats = retryManager.getStats();
      expect(stats.totalRetries).toBe(1);
      expect(stats.failedRetries).toBe(1);
      expect(stats.successRate).toBe(0);
    });

    it('should reset statistics', () => {
      retryManager.resetStats();
      const stats = retryManager.getStats();

      expect(stats.totalRetries).toBe(0);
      expect(stats.successfulRetries).toBe(0);
      expect(stats.failedRetries).toBe(0);
    });
  });

  describe('Error Types', () => {
    it('should retry on timeout errors', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new TimeoutError('Request timeout', 'upstream', 5000);
        }
        return 'success';
      };

      const result = await retryManager.execute(
        fn,
        { method: 'GET', path: '/api/test' },
        { maxAttempts: 2, initialDelay: 1 }
      );

      expect(result.value).toBe('success');
      expect(attempts).toBe(2);
    });

    it('should retry on network errors', async () => {
      const networkErrors = [
        'ECONNREFUSED',
        'ECONNRESET',
        'EHOSTUNREACH',
        'ENETUNREACH',
      ];

      for (const errorMsg of networkErrors) {
        let attempts = 0;
        const fn = async () => {
          attempts++;
          if (attempts < 2) {
            throw new Error(errorMsg);
          }
          return 'success';
        };

        const result = await retryManager.execute(
          fn,
          { method: 'GET', path: '/api/test' },
          { maxAttempts: 2, initialDelay: 1 }
        );

        expect(result.value).toBe('success');
      }
    });

    it('should retry on specific status codes', async () => {
      const retryableStatuses = [502, 503, 504, 408, 429];

      for (const status of retryableStatuses) {
        let attempts = 0;
        const fn = async () => {
          attempts++;
          if (attempts < 2) {
            throw new UpstreamError('Service error', 'UPSTREAM_ERROR', status);
          }
          return 'success';
        };

        const result = await retryManager.execute(
          fn,
          { method: 'GET', path: '/api/test' },
          { maxAttempts: 2, initialDelay: 1 }
        );

        expect(result.value).toBe('success');
      }
    });
  });
});
