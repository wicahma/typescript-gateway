/**
 * Unit tests for Auto Tuner
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AutoTuner } from '../../../src/config/auto-tuner.js';

describe('AutoTuner', () => {
  let tuner: AutoTuner;

  beforeEach(() => {
    tuner = new AutoTuner({
      enabled: true,
      observationWindow: 1000,
      minObservations: 5,
      safeMode: true,
      aggressiveness: 'moderate',
    });
  });

  afterEach(() => {
    tuner.stopTuning();
  });

  it('should create auto-tuner', () => {
    expect(tuner).toBeDefined();
  });

  it('should start and stop tuning', () => {
    tuner.startTuning();
    expect(tuner.isTuning()).toBe(true);
    
    tuner.stopTuning();
    expect(tuner.isTuning()).toBe(false);
  });

  it('should record load patterns', () => {
    const pattern = {
      avgRPS: 10000,
      peakRPS: 15000,
      avgLatency: 5,
      p99Latency: 10,
      errorRate: 0.01,
      memoryUsage: 50000000,
      cpuUsage: 0.5,
      activeConnections: 50,
    };
    
    tuner.recordLoadPattern(pattern);
  });

  it('should get recommendations', () => {
    const recommendations = tuner.getRecommendations();
    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('should get parameters', () => {
    const params = tuner.getParameters();
    expect(params).toBeInstanceOf(Map);
    expect(params.size).toBeGreaterThan(0);
  });

  it('should update parameter', () => {
    tuner.updateParameter('workerCount', 8);
    const params = tuner.getParameters();
    expect(params.get('workerCount')?.current).toBe(8);
  });

  it('should apply optimizations', async () => {
    const optimizations = [
      {
        parameter: 'workerCount',
        currentValue: 4,
        recommendedValue: 8,
        reason: 'Test optimization',
        impact: 'high' as const,
        confidence: 0.9,
      },
    ];
    
    await tuner.applyOptimizations(optimizations);
  });
});
