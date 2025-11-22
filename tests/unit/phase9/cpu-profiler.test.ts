/**
 * Unit tests for CPU Profiler
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CPUProfiler, createCPUProfiler } from '../../../src/profiling/cpu-profiler.js';

describe('CPUProfiler', () => {
  let profiler: CPUProfiler;

  beforeEach(() => {
    profiler = createCPUProfiler();
  });

  it('should create profiler with default config', () => {
    expect(profiler).toBeDefined();
    expect(profiler.isProfiling()).toBe(false);
  });

  it('should get config', () => {
    const config = profiler.getConfig();
    expect(config).toHaveProperty('samplingInterval');
    expect(config).toHaveProperty('maxSamples');
    expect(config).toHaveProperty('includeNative');
  });

  it('should start/stop sampling', () => {
    profiler.startSampling(50);
    expect(profiler).toBeDefined();
    
    const result = profiler.stopSampling();
    expect(result).toHaveProperty('samples');
    expect(result).toHaveProperty('startTime');
    expect(result).toHaveProperty('endTime');
    expect(result).toHaveProperty('totalSamples');
  });

  it('should capture samples', () => {
    profiler.startSampling(10);
    
    setTimeout(() => {
      const result = profiler.stopSampling();
      expect(result.samples.length).toBeGreaterThan(0);
    }, 50);
  });

  it('should limit samples to maxSamples', () => {
    const limitedProfiler = createCPUProfiler({ maxSamples: 5 });
    limitedProfiler.startSampling(1);
    
    setTimeout(() => {
      const result = limitedProfiler.stopSampling();
      expect(result.samples.length).toBeLessThanOrEqual(5);
    }, 50);
  });

  it('should throw on double start', () => {
    profiler.startSampling();
    expect(() => profiler.startSampling()).toThrow();
    profiler.stopSampling();
  });
});

describe('createCPUProfiler', () => {
  it('should create with custom config', () => {
    const profiler = createCPUProfiler({
      samplingInterval: 500,
      maxSamples: 5000,
      includeNative: true,
    });
    
    const config = profiler.getConfig();
    expect(config.samplingInterval).toBe(500);
    expect(config.maxSamples).toBe(5000);
    expect(config.includeNative).toBe(true);
  });
});
