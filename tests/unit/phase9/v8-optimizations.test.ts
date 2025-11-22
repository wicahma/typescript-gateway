/**
 * Unit tests for V8 optimization utilities
 * Phase 9: Performance optimization testing
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  V8Optimizer,
  createMonomorphicHandler,
  ensureHiddenClassStability,
  createStableObject,
  createPropertyAccessor,
  PolymorphismDetector,
  polymorphismDetector,
} from '../../../src/core/v8-optimizations.js';

describe('V8Optimizer', () => {
  beforeEach(() => {
    V8Optimizer.clearDeoptHistory();
  });

  describe('isOptimized', () => {
    it('should check if function is optimized', () => {
      const fn = () => 42;
      const result = V8Optimizer.isOptimized(fn);
      expect(typeof result).toBe('boolean');
    });

    it('should return true for valid functions', () => {
      const fn = (a: number, b: number) => a + b;
      expect(V8Optimizer.isOptimized(fn)).toBe(true);
    });
  });

  describe('getOptimizationStatus', () => {
    it('should return optimization status', () => {
      const fn = () => 'test';
      const status = V8Optimizer.getOptimizationStatus(fn);
      
      expect(status).toHaveProperty('isOptimized');
      expect(status).toHaveProperty('tier');
      expect(status).toHaveProperty('deoptimizations');
      expect(typeof status.deoptimizations).toBe('number');
    });

    it('should track deoptimizations', () => {
      const fn = function testFunction() { return 1; };
      V8Optimizer.recordDeoptimization('testFunction', 'test reason');
      
      const status = V8Optimizer.getOptimizationStatus(fn);
      expect(status.deoptimizations).toBeGreaterThan(0);
    });

    it('should return correct tier for hot functions', () => {
      const fn = function hotFunction() { return 1; };
      V8Optimizer.markHotFunction(fn);
      
      const status = V8Optimizer.getOptimizationStatus(fn);
      expect(status.tier).toBe('optimized');
    });
  });

  describe('analyzeObjectShape', () => {
    it('should analyze object hidden class', () => {
      const obj = { a: 1, b: 2, c: 3 };
      const analysis = V8Optimizer.analyzeObjectShape(obj);
      
      expect(analysis).toHaveProperty('properties');
      expect(analysis).toHaveProperty('hiddenClass');
      expect(analysis).toHaveProperty('isStable');
      expect(analysis.properties).toEqual(['a', 'b', 'c']);
    });

    it('should detect stable object shapes', () => {
      const obj = { x: 1, y: 2 };
      const analysis = V8Optimizer.analyzeObjectShape(obj);
      expect(analysis.isStable).toBe(true);
    });

    it('should generate consistent hidden class IDs', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { a: 3, b: 4 };
      
      const analysis1 = V8Optimizer.analyzeObjectShape(obj1);
      const analysis2 = V8Optimizer.analyzeObjectShape(obj2);
      
      expect(analysis1.hiddenClass).toBe(analysis2.hiddenClass);
    });
  });

  describe('checkDeoptimizations', () => {
    it('should return deoptimization events', () => {
      V8Optimizer.recordDeoptimization('func1', 'reason1');
      V8Optimizer.recordDeoptimization('func2', 'reason2');
      
      const deopts = V8Optimizer.checkDeoptimizations();
      expect(deopts.length).toBeGreaterThanOrEqual(2);
    });

    it('should track deopt count', () => {
      V8Optimizer.recordDeoptimization('func', 'reason1');
      V8Optimizer.recordDeoptimization('func', 'reason2');
      
      const deopts = V8Optimizer.checkDeoptimizations();
      const funcDeopts = deopts.filter(d => d.functionName === 'func');
      expect(funcDeopts.length).toBe(2);
    });

    it('should limit history to 1000 events', () => {
      for (let i = 0; i < 1200; i++) {
        V8Optimizer.recordDeoptimization(`func${i}`, 'reason');
      }
      
      const deopts = V8Optimizer.checkDeoptimizations();
      expect(deopts.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('markHotFunction', () => {
    it('should mark function as hot', () => {
      const fn = function myHotFunction() { return 1; };
      V8Optimizer.markHotFunction(fn);
      
      const status = V8Optimizer.getOptimizationStatus(fn);
      expect(status.tier).toBe('optimized');
    });
  });

  describe('benchmark', () => {
    it('should benchmark function execution', () => {
      const fn = () => Math.random();
      const result = V8Optimizer.benchmark(fn, 100);
      
      expect(result).toHaveProperty('averageTime');
      expect(result).toHaveProperty('minTime');
      expect(result).toHaveProperty('maxTime');
      expect(result).toHaveProperty('totalTime');
      expect(result.averageTime).toBeGreaterThan(0);
    });

    it('should provide accurate timing', () => {
      const fn = () => {
        let sum = 0;
        for (let i = 0; i < 100; i++) {
          sum += i;
        }
        return sum;
      };
      
      const result = V8Optimizer.benchmark(fn, 50);
      expect(result.minTime).toBeLessThanOrEqual(result.averageTime);
      expect(result.averageTime).toBeLessThanOrEqual(result.maxTime);
    });
  });

  describe('clearDeoptHistory', () => {
    it('should clear deoptimization history', () => {
      V8Optimizer.recordDeoptimization('func', 'reason');
      V8Optimizer.clearDeoptHistory();
      
      const deopts = V8Optimizer.checkDeoptimizations();
      expect(deopts.length).toBe(0);
    });
  });
});

describe('createMonomorphicHandler', () => {
  it('should create handler with fixed shape', () => {
    const handler = createMonomorphicHandler({
      type: 'TestHandler',
      properties: ['id', 'name'],
    });
    
    expect(handler.getType()).toBe('TestHandler');
  });

  it('should handle input consistently', () => {
    const handler = createMonomorphicHandler({
      type: 'DataHandler',
      properties: ['value'],
    });
    
    const input = { value: 42 };
    const result = handler.handle(input);
    expect(result).toBeDefined();
  });

  it('should return null for invalid input', () => {
    const handler = createMonomorphicHandler({
      type: 'Handler',
      properties: ['prop'],
    });
    
    expect(handler.handle(null)).toBe(null);
    expect(handler.handle(42 as any)).toBe(null);
  });
});

describe('ensureHiddenClassStability', () => {
  it('should not throw for stable objects', () => {
    const obj = { a: 1, b: 2 };
    expect(() => ensureHiddenClassStability(obj)).not.toThrow();
  });

  it('should handle empty objects', () => {
    const obj = {};
    expect(() => ensureHiddenClassStability(obj)).not.toThrow();
  });
});

describe('createStableObject', () => {
  it('should create object with sorted properties', () => {
    const template = { z: 3, a: 1, m: 2 };
    const obj = createStableObject(template);
    
    const keys = Object.keys(obj);
    const sortedKeys = [...keys].sort();
    expect(keys).toEqual(sortedKeys);
  });

  it('should preserve values', () => {
    const template = { name: 'test', value: 42 };
    const obj = createStableObject(template);
    
    expect(obj.name).toBe('test');
    expect(obj.value).toBe(42);
  });
});

describe('createPropertyAccessor', () => {
  it('should create accessor function', () => {
    const obj = { prop: 'value' };
    const accessor = createPropertyAccessor(obj, 'prop');
    
    expect(typeof accessor).toBe('function');
    expect(accessor()).toBe('value');
  });

  it('should track property changes', () => {
    const obj = { count: 0 };
    const accessor = createPropertyAccessor(obj, 'count');
    
    expect(accessor()).toBe(0);
    obj.count = 5;
    expect(accessor()).toBe(5);
  });
});

describe('PolymorphismDetector', () => {
  let detector: PolymorphismDetector;

  beforeEach(() => {
    detector = new PolymorphismDetector();
  });

  it('should track type usage', () => {
    detector.trackType('callSite1', 'string');
    detector.trackType('callSite1', 'number');
    
    const report = detector.getReport();
    expect(report.get('callSite1')).toBe(2);
  });

  it('should detect polymorphism', () => {
    for (let i = 0; i < 5; i++) {
      detector.trackType('hotSpot', `type${i}`);
    }
    
    const report = detector.getReport();
    expect(report.get('hotSpot')).toBe(5);
  });

  it('should reset tracking data', () => {
    detector.trackType('site', 'type');
    detector.reset();
    
    const report = detector.getReport();
    expect(report.size).toBe(0);
  });
});

describe('polymorphismDetector singleton', () => {
  it('should be available as singleton', () => {
    expect(polymorphismDetector).toBeDefined();
    expect(polymorphismDetector).toBeInstanceOf(PolymorphismDetector);
  });
});
