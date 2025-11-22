/**
 * Unit tests for cleanup manager
 * Phase 7: Resilience & Error Handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CleanupManager, ResourceType } from '../../src/core/cleanup-manager.js';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

describe('CleanupManager', () => {
  let manager: CleanupManager;

  beforeEach(() => {
    manager = new CleanupManager();
  });

  describe('Resource Tracking', () => {
    it('should track a resource', () => {
      let cleaned = false;
      const resourceId = manager.track(
        ResourceType.TIMER,
        () => {
          cleaned = true;
        }
      );

      expect(resourceId).toBeDefined();
      expect(cleaned).toBe(false);
    });

    it('should track resource with request ID', () => {
      const resourceId = manager.track(ResourceType.TIMER, () => {}, 'req-123');
      const resources = manager.getActiveResources('req-123');

      expect(resources.length).toBe(1);
      expect(resources[0].id).toBe(resourceId);
    });

    it('should track multiple resources', () => {
      manager.track(ResourceType.TIMER, () => {});
      manager.track(ResourceType.CONNECTION, () => {});
      manager.track(ResourceType.STREAM, () => {});

      const stats = manager.getStats();
      expect(stats.activeResources).toBe(3);
    });
  });

  describe('Timer Tracking', () => {
    it('should track timer', () => {
      const timer = setTimeout(() => {}, 1000);
      const resourceId = manager.trackTimer(timer);

      expect(resourceId).toBeDefined();

      // Cleanup
      clearTimeout(timer);
    });

    it('should cleanup timer', async () => {
      let executed = false;
      const timer = setTimeout(() => {
        executed = true;
      }, 100);

      const resourceId = manager.trackTimer(timer);
      await manager.cleanup(resourceId);

      // Wait to ensure timer doesn't execute
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(executed).toBe(false);
    });
  });

  describe('Stream Tracking', () => {
    it('should track stream', () => {
      const stream = new Readable();
      const resourceId = manager.trackStream(stream);

      expect(resourceId).toBeDefined();
    });

    it('should cleanup stream', async () => {
      const stream = new Readable({
        read() {
          this.push('data');
        },
      });

      let destroyed = false;
      stream.on('close', () => {
        destroyed = true;
      });

      const resourceId = manager.trackStream(stream);
      await manager.cleanup(resourceId);

      // Give some time for the 'close' event to fire
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(destroyed).toBe(true);
    });
  });

  describe('Event Listener Tracking', () => {
    it('should track event listener', () => {
      const emitter = new EventEmitter();
      const listener = () => {};

      const resourceId = manager.trackEventListener(
        emitter,
        'test',
        listener
      );

      expect(resourceId).toBeDefined();
    });

    it('should cleanup event listener', async () => {
      const emitter = new EventEmitter();
      let callCount = 0;
      const listener = () => {
        callCount++;
      };

      // Add the listener first
      emitter.on('test', listener);

      const resourceId = manager.trackEventListener(
        emitter,
        'test',
        listener
      );

      // First call should increment (synchronous)
      emitter.emit('test');
      expect(callCount).toBe(1);

      await manager.cleanup(resourceId);

      // After cleanup, should not increment
      emitter.emit('test');
      expect(callCount).toBe(1); // Should not increment
    });
  });

  describe('AbortController Tracking', () => {
    it('should track AbortController', () => {
      const controller = new AbortController();
      const resourceId = manager.trackAbortController(controller);

      expect(resourceId).toBeDefined();
      expect(controller.signal.aborted).toBe(false);
    });

    it('should cleanup AbortController', async () => {
      const controller = new AbortController();
      const resourceId = manager.trackAbortController(controller);

      await manager.cleanup(resourceId);

      expect(controller.signal.aborted).toBe(true);
    });
  });

  describe('Resource Cleanup', () => {
    it('should cleanup specific resource', async () => {
      let cleaned = false;
      const resourceId = manager.track(ResourceType.TIMER, () => {
        cleaned = true;
      });

      await manager.cleanup(resourceId);

      expect(cleaned).toBe(true);
    });

    it('should cleanup all resources for request', async () => {
      let count = 0;
      const cleanup = () => {
        count++;
      };

      manager.track(ResourceType.TIMER, cleanup, 'req-123');
      manager.track(ResourceType.CONNECTION, cleanup, 'req-123');
      manager.track(ResourceType.STREAM, cleanup, 'req-123');

      await manager.cleanupRequest('req-123');

      expect(count).toBe(3);
    });

    it('should cleanup all resources', async () => {
      let count = 0;
      const cleanup = () => {
        count++;
      };

      manager.track(ResourceType.TIMER, cleanup);
      manager.track(ResourceType.CONNECTION, cleanup);
      manager.track(ResourceType.STREAM, cleanup);

      await manager.cleanupAll();

      expect(count).toBe(3);
      expect(manager.getStats().activeResources).toBe(0);
    });

    it('should not cleanup already cleaned resources', async () => {
      let count = 0;
      const resourceId = manager.track(ResourceType.TIMER, () => {
        count++;
      });

      await manager.cleanup(resourceId);
      await manager.cleanup(resourceId); // Second cleanup

      expect(count).toBe(1); // Should only cleanup once
    });

    it('should handle cleanup errors gracefully', async () => {
      const resourceId = manager.track(ResourceType.TIMER, () => {
        throw new Error('Cleanup error');
      });

      // Should not throw
      await expect(manager.cleanup(resourceId)).resolves.toBeUndefined();
    });
  });

  describe('Active Resources', () => {
    it('should get all active resources', () => {
      manager.track(ResourceType.TIMER, () => {});
      manager.track(ResourceType.CONNECTION, () => {});

      const resources = manager.getActiveResources();

      expect(resources.length).toBe(2);
    });

    it('should get active resources for specific request', () => {
      manager.track(ResourceType.TIMER, () => {}, 'req-123');
      manager.track(ResourceType.CONNECTION, () => {}, 'req-123');
      manager.track(ResourceType.STREAM, () => {}, 'req-456');

      const resources = manager.getActiveResources('req-123');

      expect(resources.length).toBe(2);
    });

    it('should return empty array for unknown request', () => {
      const resources = manager.getActiveResources('req-unknown');
      expect(resources.length).toBe(0);
    });
  });

  describe('Leak Detection', () => {
    it('should detect potential leaks', async () => {
      const mgr = new CleanupManager({
        enableLeakDetection: true,
        leakDetectionThreshold: 100,
      });

      mgr.track(ResourceType.TIMER, () => {});

      // Wait for threshold
      await new Promise((resolve) => setTimeout(resolve, 150));

      const leaks = mgr.detectLeaks();

      expect(leaks.length).toBe(1);

      await mgr.destroy();
    });

    it('should not detect leaks when disabled', () => {
      const mgr = new CleanupManager({
        enableLeakDetection: false,
      });

      mgr.track(ResourceType.TIMER, () => {});

      const leaks = mgr.detectLeaks();

      expect(leaks.length).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should track statistics', async () => {
      manager.track(ResourceType.TIMER, () => {});
      manager.track(ResourceType.CONNECTION, () => {});

      const stats = manager.getStats();

      expect(stats.totalTracked).toBe(2);
      expect(stats.activeResources).toBe(2);
      expect(stats.byType[ResourceType.TIMER]).toBe(1);
      expect(stats.byType[ResourceType.CONNECTION]).toBe(1);
    });

    it('should track cleanup statistics', async () => {
      const resourceId = manager.track(ResourceType.TIMER, () => {});

      await manager.cleanup(resourceId);

      const stats = manager.getStats();

      expect(stats.totalCleaned).toBe(1);
      expect(stats.activeResources).toBe(0);
    });

    it('should calculate average cleanup time', async () => {
      const resourceId1 = manager.track(ResourceType.TIMER, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const resourceId2 = manager.track(ResourceType.TIMER, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await manager.cleanup(resourceId1);
      await manager.cleanup(resourceId2);

      const stats = manager.getStats();

      expect(stats.avgCleanupTime).toBeGreaterThan(0);
    });

    it('should reset statistics', () => {
      manager.track(ResourceType.TIMER, () => {});
      manager.resetStats();

      const stats = manager.getStats();

      expect(stats.totalTracked).toBe(0);
      expect(stats.totalCleaned).toBe(0);
    });
  });

  describe('Configuration', () => {
    it('should update configuration', () => {
      manager.updateConfig({
        enableLeakDetection: true,
        leakDetectionThreshold: 30000,
      });

      // Configuration updated successfully if no error
      expect(manager).toBeDefined();
    });
  });

  describe('Destroy', () => {
    it('should destroy manager and cleanup all resources', async () => {
      let count = 0;
      manager.track(ResourceType.TIMER, () => {
        count++;
      });
      manager.track(ResourceType.CONNECTION, () => {
        count++;
      });

      await manager.destroy();

      expect(count).toBe(2);
      expect(manager.getStats().activeResources).toBe(0);
    });
  });

  describe('Metadata', () => {
    it('should store resource metadata', () => {
      const metadata = { key: 'value', number: 42 };
      const resourceId = manager.track(
        ResourceType.TIMER,
        () => {},
        undefined,
        metadata
      );

      const resources = manager.getActiveResources();
      const resource = resources.find((r) => r.id === resourceId);

      expect(resource?.metadata).toEqual(metadata);
    });
  });

  describe('Resource Types', () => {
    it('should track different resource types separately', () => {
      manager.track(ResourceType.TIMER, () => {});
      manager.track(ResourceType.TIMER, () => {});
      manager.track(ResourceType.CONNECTION, () => {});
      manager.track(ResourceType.STREAM, () => {});

      const stats = manager.getStats();

      expect(stats.byType[ResourceType.TIMER]).toBe(2);
      expect(stats.byType[ResourceType.CONNECTION]).toBe(1);
      expect(stats.byType[ResourceType.STREAM]).toBe(1);
    });
  });
});
