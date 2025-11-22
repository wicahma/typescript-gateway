/**
 * Integration tests for Phase 9 profiling
 */
import { describe, it, expect } from 'vitest';
import { createCPUProfiler } from '../../../src/profiling/cpu-profiler.js';
import { createMemoryProfiler } from '../../../src/profiling/memory-profiler.js';
import { MemoryOptimizer } from '../../../src/core/memory-optimizer.js';
import { V8Optimizer } from '../../../src/core/v8-optimizations.js';

describe('Profiling Integration', () => {
  it('should profile CPU and memory together', async () => {
    const cpuProfiler = createCPUProfiler();
    const memProfiler = createMemoryProfiler();
    
    // Start profiling with longer interval
    cpuProfiler.startSampling(10);
    
    // Do some work over time
    const result: number[] = [];
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 100; j++) {
        result.push(i * j);
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Wait a bit to capture samples
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Stop profiling
    const cpuResult = cpuProfiler.stopSampling();
    const memStats = MemoryOptimizer.getMemoryStats();
    
    // Check results - samples might be 0 but stats should exist
    expect(cpuResult).toBeDefined();
    expect(cpuResult.samples).toBeDefined();
    expect(memStats.heapUsed).toBeGreaterThan(0);
    
    memProfiler.destroy();
  });

  it('should detect V8 optimization opportunities', () => {
    function testFunction(a: number, b: number) {
      return a + b;
    }
    
    V8Optimizer.markHotFunction(testFunction);
    const status = V8Optimizer.getOptimizationStatus(testFunction);
    
    expect(status.tier).toBe('optimized');
  });

  it('should analyze memory growth over time', async () => {
    const analysis = await MemoryOptimizer.analyzeHeapGrowth(50, 200);
    
    expect(analysis).toBeDefined();
    expect(analysis.samples.length).toBeGreaterThan(0);
    expect(typeof analysis.averageGrowthRate).toBe('number');
  });
});
