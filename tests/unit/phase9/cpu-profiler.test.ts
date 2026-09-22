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

  it('should capture samples', async () => {
    profiler.startSampling(10);

    await new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        try {
          const result = profiler.stopSampling();
          expect(result.samples.length).toBeGreaterThan(0);
          resolve();
        } catch (e) {
          reject(e);
        }
      }, 50);
    });
  });

  it('should limit samples to maxSamples', async () => {
    const limitedProfiler = createCPUProfiler({ maxSamples: 5 });
    limitedProfiler.startSampling(1);

    await new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        try {
          const result = limitedProfiler.stopSampling();
          expect(result.samples.length).toBeLessThanOrEqual(5);
          resolve();
        } catch (e) {
          reject(e);
        }
      }, 50);
    });
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
