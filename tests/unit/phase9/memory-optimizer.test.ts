/**
 * Unit tests for Memory Optimizer
 * Phase 9
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryOptimizer } from '../../../src/core/memory-optimizer.js';

describe('MemoryOptimizer', () => {
  beforeEach(() => {
    MemoryOptimizer.clearHistory();
  });

  describe('getMemoryStats', () => {
    it('should return memory statistics', () => {
      const stats = MemoryOptimizer.getMemoryStats();
      
      expect(stats).toHaveProperty('heapUsed');
      expect(stats).toHaveProperty('heapTotal');
      expect(stats).toHaveProperty('external');
      expect(stats).toHaveProperty('arrayBuffers');
      expect(stats).toHaveProperty('rss');
      expect(stats.heapUsed).toBeGreaterThan(0);
    });

    it('should track memory history', () => {
      MemoryOptimizer.getMemoryStats();
      MemoryOptimizer.getMemoryStats();
      
      const history = MemoryOptimizer.getMemoryHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
    });

    it('should limit history to 1000 samples', () => {
      for (let i = 0; i < 1200; i++) {
        MemoryOptimizer.getMemoryStats();
      }
      
      const history = MemoryOptimizer.getMemoryHistory();
      expect(history.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('formatMemoryStats', () => {
    it('should format memory stats as string', () => {
      const stats = MemoryOptimizer.getMemoryStats();
      const formatted = MemoryOptimizer.formatMemoryStats(stats);
      
      expect(typeof formatted).toBe('string');
      expect(formatted).toContain('MB');
      expect(formatted).toContain('Heap Used');
    });
  });

  describe('analyzeHeapGrowth', () => {
    it('should analyze heap growth over time', async () => {
      const analysis = await MemoryOptimizer.analyzeHeapGrowth(50, 200);
      
      expect(analysis).toHaveProperty('averageGrowthRate');
      expect(analysis).toHaveProperty('isLeaking');
      expect(analysis).toHaveProperty('suspiciousObjects');
      expect(analysis).toHaveProperty('samples');
      expect(analysis.samples.length).toBeGreaterThan(0);
    });

    it('should detect when not leaking', async () => {
      const analysis = await MemoryOptimizer.analyzeHeapGrowth(50, 200);
      expect(typeof analysis.isLeaking).toBe('boolean');
    });
  });

  describe('detectMemoryLeaks', () => {
    it('should return leak reports', () => {
      // Populate history
      for (let i = 0; i < 20; i++) {
        MemoryOptimizer.getMemoryStats();
      }
      
      const leaks = MemoryOptimizer.detectMemoryLeaks(10);
      expect(Array.isArray(leaks)).toBe(true);
    });

    it('should return empty array with insufficient data', () => {
      const leaks = MemoryOptimizer.detectMemoryLeaks();
      expect(leaks).toEqual([]);
    });
  });

  describe('optimizeGCStrategy', () => {
    it('should not throw for latency workload', () => {
      expect(() => MemoryOptimizer.optimizeGCStrategy('latency')).not.toThrow();
    });

    it('should not throw for throughput workload', () => {
      expect(() => MemoryOptimizer.optimizeGCStrategy('throughput')).not.toThrow();
    });
  });

  describe('getRecommendations', () => {
    it('should provide recommendations', () => {
      const recommendations = MemoryOptimizer.getRecommendations();
      expect(Array.isArray(recommendations)).toBe(true);
    });

    it('should return strings', () => {
      const recommendations = MemoryOptimizer.getRecommendations();
      recommendations.forEach(rec => {
        expect(typeof rec).toBe('string');
      });
    });
  });

  describe('forceGC', () => {
    it('should not throw when GC not exposed', () => {
      expect(() => MemoryOptimizer.forceGC()).not.toThrow();
    });
  });

  describe('getGCStats', () => {
    it('should return GC statistics', () => {
      const stats = MemoryOptimizer.getGCStats();
      
      expect(stats).toHaveProperty('count');
      expect(stats).toHaveProperty('totalTime');
      expect(stats).toHaveProperty('averageTime');
      expect(stats).toHaveProperty('lastGCTime');
    });
  });

  describe('startMonitoring/stopMonitoring', () => {
    it('should start and stop monitoring', () => {
      const timer = MemoryOptimizer.startMonitoring(100);
      expect(timer).toBeDefined();
      
      MemoryOptimizer.stopMonitoring(timer);
    });
  });

  describe('generateReport', () => {
    it('should generate JSON report', async () => {
      const report = await MemoryOptimizer.generateReport();
      
      expect(typeof report).toBe('string');
      const parsed = JSON.parse(report);
      expect(parsed).toHaveProperty('timestamp');
      expect(parsed).toHaveProperty('memory');
    });
  });

  describe('clearHistory', () => {
    it('should clear memory history', () => {
      MemoryOptimizer.getMemoryStats();
      MemoryOptimizer.clearHistory();
      
      const history = MemoryOptimizer.getMemoryHistory();
      expect(history.length).toBe(0);
    });
  });
});
