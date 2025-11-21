/**
 * Unit tests for timeout manager
 * Phase 7: Resilience & Error Handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TimeoutManager } from '../../src/core/timeout-manager.js';
import { TimeoutError } from '../../src/core/errors.js';

describe('TimeoutManager', () => {
  let timeoutManager: TimeoutManager;

  beforeEach(() => {
    timeoutManager = new TimeoutManager();
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      expect(timeoutManager.getTimeout('connection')).toBe(5000);
      expect(timeoutManager.getTimeout('request')).toBe(30000);
      expect(timeoutManager.getTimeout('upstream')).toBe(20000);
      expect(timeoutManager.getTimeout('plugin')).toBe(1000);
    });

    it('should accept custom configuration', () => {
      const manager = new TimeoutManager({
        connection: 10000,
        request: 60000,
      });

      expect(manager.getTimeout('connection')).toBe(10000);
      expect(manager.getTimeout('request')).toBe(60000);
    });

    it('should update configuration', () => {
      timeoutManager.updateConfig({ connection: 15000 });
      expect(timeoutManager.getTimeout('connection')).toBe(15000);
    });
  });

  describe('Execute with Timeout', () => {
    it('should resolve when function completes before timeout', async () => {
      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'success';
      };

      const result = await timeoutManager.execute(fn, 'request', undefined, 200);
      expect(result).toBe('success');
    });

    it('should reject with TimeoutError when function exceeds timeout', async () => {
      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'success';
      };

      await expect(
        timeoutManager.execute(fn, 'request', undefined, 50)
      ).rejects.toThrow(TimeoutError);
    });

    it('should include timeout type in error', async () => {
      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'success';
      };

      try {
        await timeoutManager.execute(fn, 'upstream', undefined, 50);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError);
        const timeoutError = error as TimeoutError;
        expect(timeoutError.timeoutType).toBe('upstream');
        expect(timeoutError.timeoutMs).toBe(50);
      }
    });

    it('should include request context in timeout error', async () => {
      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'success';
      };

      const context = {
        requestId: 'req-123',
        operation: 'test operation',
      };

      try {
        await timeoutManager.execute(fn, 'request', context, 50);
        expect.fail('Should have thrown');
      } catch (error) {
        const timeoutError = error as TimeoutError;
        expect(timeoutError.requestContext?.requestId).toBe('req-123');
      }
    });

    it('should propagate function errors', async () => {
      const fn = async () => {
        throw new Error('Function error');
      };

      await expect(
        timeoutManager.execute(fn, 'request', undefined, 200)
      ).rejects.toThrow('Function error');
    });
  });

  describe('Timeout Handles', () => {
    it('should create timeout handle with AbortController', () => {
      const handle = timeoutManager.createHandle('connection');

      expect(handle.handleId).toBeDefined();
      expect(handle.signal).toBeDefined();
      expect(handle.cancel).toBeDefined();

      handle.cancel();
    });

    it('should cancel timeout handle', () => {
      const handle = timeoutManager.createHandle('connection', undefined, 100);
      
      expect(timeoutManager.getActiveCount()).toBe(1);
      
      handle.cancel();
      
      expect(timeoutManager.getActiveCount()).toBe(0);
    });

    it('should timeout handle after duration', async () => {
      const handle = timeoutManager.createHandle('connection', undefined, 50);

      expect(handle.signal.aborted).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handle.signal.aborted).toBe(true);
    });

    it('should cancel handle by ID', () => {
      const handle = timeoutManager.createHandle('connection');
      
      expect(timeoutManager.getActiveCount()).toBe(1);
      
      timeoutManager.cancel(handle.handleId);
      
      expect(timeoutManager.getActiveCount()).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should track timeout statistics', async () => {
      timeoutManager.resetStats();

      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'success';
      };

      try {
        await timeoutManager.execute(fn, 'request', undefined, 50);
      } catch {
        // Expected
      }

      const stats = timeoutManager.getStats();
      expect(stats.totalTimeouts).toBe(1);
      expect(stats.timeoutsByType.request).toBe(1);
    });

    it('should track timeouts by type', async () => {
      timeoutManager.resetStats();

      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'success';
      };

      // Trigger different timeout types
      try {
        await timeoutManager.execute(fn, 'connection', undefined, 50);
      } catch {
        // Expected
      }

      try {
        await timeoutManager.execute(fn, 'upstream', undefined, 50);
      } catch {
        // Expected
      }

      const stats = timeoutManager.getStats();
      expect(stats.timeoutsByType.connection).toBe(1);
      expect(stats.timeoutsByType.upstream).toBe(1);
    });

    it('should track active timeouts', () => {
      const handle1 = timeoutManager.createHandle('connection');
      const handle2 = timeoutManager.createHandle('request');

      expect(timeoutManager.getActiveCount()).toBe(2);

      handle1.cancel();
      expect(timeoutManager.getActiveCount()).toBe(1);

      handle2.cancel();
      expect(timeoutManager.getActiveCount()).toBe(0);
    });

    it('should reset statistics', () => {
      timeoutManager.resetStats();
      const stats = timeoutManager.getStats();

      expect(stats.totalTimeouts).toBe(0);
      expect(stats.activeTimeouts).toBe(0);
    });
  });

  describe('Handle Management', () => {
    it('should check if handle timed out', async () => {
      const handle = timeoutManager.createHandle('connection', undefined, 50);

      expect(timeoutManager.hasTimedOut(handle.handleId)).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(timeoutManager.hasTimedOut(handle.handleId)).toBe(true);
    });

    it('should get elapsed time for handle', async () => {
      const handle = timeoutManager.createHandle('connection');

      await new Promise((resolve) => setTimeout(resolve, 100));

      const elapsed = timeoutManager.getElapsed(handle.handleId);
      expect(elapsed).toBeGreaterThanOrEqual(90);
      expect(elapsed).toBeLessThanOrEqual(150);

      handle.cancel();
    });

    it('should cancel all timeouts', () => {
      timeoutManager.createHandle('connection');
      timeoutManager.createHandle('request');
      timeoutManager.createHandle('upstream');

      expect(timeoutManager.getActiveCount()).toBe(3);

      timeoutManager.cancelAll();

      expect(timeoutManager.getActiveCount()).toBe(0);
    });
  });

  describe('Cleanup', () => {
    it('should cleanup on success', async () => {
      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'success';
      };

      await timeoutManager.execute(fn, 'request', undefined, 200);

      expect(timeoutManager.getActiveCount()).toBe(0);
    });

    it('should cleanup on timeout', async () => {
      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'success';
      };

      try {
        await timeoutManager.execute(fn, 'request', undefined, 50);
      } catch {
        // Expected
      }

      // Give some time for cleanup
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(timeoutManager.getActiveCount()).toBe(0);
    });

    it('should cleanup on error', async () => {
      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        throw new Error('Function error');
      };

      try {
        await timeoutManager.execute(fn, 'request', undefined, 200);
      } catch {
        // Expected
      }

      expect(timeoutManager.getActiveCount()).toBe(0);
    });
  });

  describe('Destroy', () => {
    it('should destroy and cleanup all resources', () => {
      timeoutManager.createHandle('connection');
      timeoutManager.createHandle('request');

      expect(timeoutManager.getActiveCount()).toBe(2);

      timeoutManager.destroy();

      expect(timeoutManager.getActiveCount()).toBe(0);
    });
  });
});
