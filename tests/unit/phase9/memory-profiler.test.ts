/**
 * Unit tests for Memory Profiler
 */
import { describe, it, expect } from 'vitest';
import { MemoryProfiler, createMemoryProfiler } from '../../../src/profiling/memory-profiler.js';

describe('MemoryProfiler', () => {
  let profiler: MemoryProfiler;

  beforeEach(() => {
    profiler = createMemoryProfiler();
  });

  it('should create profiler', () => {
    expect(profiler).toBeDefined();
  });

  it('should get snapshots', () => {
    const snapshots = profiler.getSnapshots();
    expect(Array.isArray(snapshots)).toBe(true);
  });

  it('should monitor GC', () => {
    const monitor = profiler.monitorGC();
    expect(monitor).toBeDefined();
    expect(monitor).toHaveProperty('start');
    expect(monitor).toHaveProperty('stop');
    expect(monitor).toHaveProperty('getEvents');
    expect(monitor).toHaveProperty('getStats');
  });

  it('should start and stop GC monitoring', () => {
    const monitor = profiler.monitorGC();
    monitor.start();
    monitor.stop();
    
    const stats = monitor.getStats();
    expect(stats).toHaveProperty('totalEvents');
    expect(stats).toHaveProperty('totalTime');
    expect(stats).toHaveProperty('averageDuration');
  });

  it('should destroy profiler', () => {
    profiler.destroy();
    expect(profiler).toBeDefined();
  });

  it('should start/stop auto snapshot', () => {
    profiler.startAutoSnapshot();
    profiler.stopAutoSnapshot();
  });
});

describe('createMemoryProfiler', () => {
  it('should create with custom config', () => {
    const profiler = createMemoryProfiler({
      retentionDays: 14,
      autoSnapshot: false,
    });
    
    expect(profiler).toBeDefined();
  });
});
