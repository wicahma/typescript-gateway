/**
 * Unit tests for Circuit Breaker
 * Phase 4: Upstream Integration & Resilience
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerEvent } from '../../src/core/circuit-breaker.js';
import { CircuitBreakerState } from '../../src/types/core.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test-upstream', {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 1000,
      windowSize: 5,
    });
  });

  describe('State transitions', () => {
    it('should start in CLOSED state', () => {
      expect(breaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should transition to OPEN after failure threshold', async () => {
      // Cause failures
      for (let i = 0; i < 5; i++) {
        await expect(
          breaker.execute(async () => {
            throw new Error('Upstream failure');
          })
        ).rejects.toThrow('Upstream failure');
      }

      expect(breaker.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should transition to HALF_OPEN after timeout', async () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        await expect(
          breaker.execute(async () => {
            throw new Error('Failure');
          })
        ).rejects.toThrow();
      }

      expect(breaker.getState()).toBe(CircuitBreakerState.OPEN);

      // Wait for timeout (using short timeout for testing)
      const shortBreaker = new CircuitBreaker('test', {
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 50,
        windowSize: 5,
      });

      for (let i = 0; i < 5; i++) {
        await expect(
          shortBreaker.execute(async () => {
            throw new Error('Failure');
          })
        ).rejects.toThrow();
      }

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Next request should trigger HALF_OPEN
      await expect(
        shortBreaker.execute(async () => {
          return 'success';
        })
      ).resolves.toBe('success');

      expect(shortBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);
    });

    it('should transition back to CLOSED after successful requests in HALF_OPEN', async () => {
      breaker.forceState(CircuitBreakerState.HALF_OPEN);

      // Execute successful requests
      for (let i = 0; i < 2; i++) {
        await breaker.execute(async () => 'success');
      }

      expect(breaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should transition back to OPEN on failure in HALF_OPEN', async () => {
      breaker.forceState(CircuitBreakerState.HALF_OPEN);

      await expect(
        breaker.execute(async () => {
          throw new Error('Failure');
        })
      ).rejects.toThrow();

      expect(breaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('Request execution', () => {
    it('should execute requests when CLOSED', async () => {
      const result = await breaker.execute(async () => 'success');
      expect(result).toBe('success');
    });

    it('should reject requests when OPEN', async () => {
      breaker.forceState(CircuitBreakerState.OPEN);

      await expect(breaker.execute(async () => 'success')).rejects.toThrow(
        'Circuit breaker is OPEN'
      );
    });

    it('should allow limited requests when HALF_OPEN', async () => {
      breaker.forceState(CircuitBreakerState.HALF_OPEN);

      // Should allow success threshold number of requests
      await breaker.execute(async () => 'success');
      await breaker.execute(async () => 'success');

      // Circuit should now be CLOSED
      expect(breaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should handle async errors correctly', async () => {
      await expect(
        breaker.execute(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error('Async error');
        })
      ).rejects.toThrow('Async error');
    });

    it('should preserve return values', async () => {
      const result = await breaker.execute(async () => ({ data: 'test', value: 123 }));
      expect(result).toEqual({ data: 'test', value: 123 });
    });
  });

  describe('Metrics tracking', () => {
    it('should track successful requests', async () => {
      await breaker.execute(async () => 'success');
      await breaker.execute(async () => 'success');

      const metrics = breaker.getMetrics();
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.successfulRequests).toBe(2);
      expect(metrics.failedRequests).toBe(0);
    });

    it('should track failed requests', async () => {
      try {
        await breaker.execute(async () => {
          throw new Error('Failure');
        });
      } catch {
        // Expected
      }

      const metrics = breaker.getMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.successfulRequests).toBe(0);
      expect(metrics.failedRequests).toBe(1);
    });

    it('should track rejected requests', async () => {
      breaker.forceState(CircuitBreakerState.OPEN);

      try {
        await breaker.execute(async () => 'success');
      } catch {
        // Expected
      }

      const metrics = breaker.getMetrics();
      expect(metrics.rejectedRequests).toBe(1);
    });

    it('should calculate success and failure rates', async () => {
      await breaker.execute(async () => 'success');
      await breaker.execute(async () => 'success');

      try {
        await breaker.execute(async () => {
          throw new Error('Failure');
        });
      } catch {
        // Expected
      }

      const metrics = breaker.getMetrics();
      expect(metrics.successRate).toBeCloseTo(66.67, 1);
      expect(metrics.failureRate).toBeCloseTo(33.33, 1);
    });

    it('should track state changes', async () => {
      const initialMetrics = breaker.getMetrics();
      expect(initialMetrics.stateChanges).toBe(0);

      // Force state change
      breaker.forceState(CircuitBreakerState.OPEN);

      const metrics = breaker.getMetrics();
      expect(metrics.stateChanges).toBe(1);
    });

    it('should track time in state', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const metrics = breaker.getMetrics();
      expect(metrics.timeInState).toBeGreaterThan(40);
    });
  });

  describe('Sliding window', () => {
    it('should maintain window size', async () => {
      // Execute more requests than window size
      for (let i = 0; i < 10; i++) {
        await breaker.execute(async () => 'success');
      }

      // Force some failures
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch {
          // Expected
        }
      }

      // Should still be CLOSED because failures are less than threshold
      expect(breaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should only consider recent requests', async () => {
      // Fill window with successes
      for (let i = 0; i < 5; i++) {
        await breaker.execute(async () => 'success');
      }

      // Add failures (should push out successes)
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch {
          // Expected
        }
      }

      // Circuit should open
      expect(breaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('Event handling', () => {
    it('should emit state change events', async () => {
      const listener = vi.fn();
      breaker.on(CircuitBreakerEvent.STATE_CHANGE, listener);

      breaker.forceState(CircuitBreakerState.OPEN);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          oldState: CircuitBreakerState.CLOSED,
          newState: CircuitBreakerState.OPEN,
        })
      );
    });

    it('should emit request success events', async () => {
      const listener = vi.fn();
      breaker.on(CircuitBreakerEvent.REQUEST_SUCCESS, listener);

      await breaker.execute(async () => 'success');

      expect(listener).toHaveBeenCalled();
    });

    it('should emit request failure events', async () => {
      const listener = vi.fn();
      breaker.on(CircuitBreakerEvent.REQUEST_FAILURE, listener);

      try {
        await breaker.execute(async () => {
          throw new Error('Failure');
        });
      } catch {
        // Expected
      }

      expect(listener).toHaveBeenCalled();
    });

    it('should emit request rejected events', async () => {
      const listener = vi.fn();
      breaker.on(CircuitBreakerEvent.REQUEST_REJECTED, listener);

      breaker.forceState(CircuitBreakerState.OPEN);

      try {
        await breaker.execute(async () => 'success');
      } catch {
        // Expected
      }

      expect(listener).toHaveBeenCalled();
    });

    it('should support removing listeners', async () => {
      const listener = vi.fn();
      breaker.on(CircuitBreakerEvent.REQUEST_SUCCESS, listener);
      breaker.off(CircuitBreakerEvent.REQUEST_SUCCESS, listener);

      await breaker.execute(async () => 'success');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Reset functionality', () => {
    it('should reset circuit breaker to initial state', async () => {
      // Execute some requests
      await breaker.execute(async () => 'success');

      try {
        await breaker.execute(async () => {
          throw new Error('Failure');
        });
      } catch {
        // Expected
      }

      // Reset
      breaker.reset();

      const metrics = breaker.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.successfulRequests).toBe(0);
      expect(metrics.failedRequests).toBe(0);
      expect(breaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should clear metrics on reset', async () => {
      breaker.forceState(CircuitBreakerState.OPEN);

      const beforeReset = breaker.getMetrics();
      expect(beforeReset.stateChanges).toBeGreaterThan(0);

      breaker.reset();

      const afterReset = breaker.getMetrics();
      expect(afterReset.stateChanges).toBe(0);
    });
  });

  describe('Performance', () => {
    it('should have minimal overhead when CLOSED', async () => {
      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        await breaker.execute(async () => 'success');
      }

      const duration = Date.now() - start;
      const avgOverhead = duration / 100;

      // Target: < 0.05ms overhead per request (but allow more in test environment)
      expect(avgOverhead).toBeLessThan(5);
    });

    it('should reject quickly when OPEN', async () => {
      breaker.forceState(CircuitBreakerState.OPEN);

      const start = Date.now();

      try {
        await breaker.execute(async () => 'success');
      } catch {
        // Expected
      }

      const duration = Date.now() - start;

      // Target: < 0.1ms rejection (but allow more in test environment)
      expect(duration).toBeLessThan(10);
    });
  });

  describe('Configuration', () => {
    it('should respect custom failure threshold', async () => {
      const customBreaker = new CircuitBreaker('test', {
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 1000,
        windowSize: 5,
      });

      // Need to fill window with enough failures
      for (let i = 0; i < 5; i++) {
        try {
          await customBreaker.execute(async () => {
            throw new Error('Failure');
          });
        } catch {
          // Expected
        }
      }

      expect(customBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should respect custom success threshold', async () => {
      const customBreaker = new CircuitBreaker('test', {
        failureThreshold: 3,
        successThreshold: 1,
        timeout: 1000,
        windowSize: 5,
      });

      customBreaker.forceState(CircuitBreakerState.HALF_OPEN);

      // Should close after 1 success (not 2)
      await customBreaker.execute(async () => 'success');

      expect(customBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });
  });
});
