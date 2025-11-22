# Phase 9: Optimization Guide

## V8 Optimization Best Practices

### 1. Maintain Monomorphic Functions
```typescript
// ❌ Polymorphic - will deoptimize
function process(data: any) {
  return data.value;
}

// ✅ Monomorphic - stays optimized
function processNumber(data: { value: number }) {
  return data.value;
}

function processString(data: { value: string }) {
  return data.value;
}
```

### 2. Keep Hidden Classes Stable
```typescript
// ❌ Unstable - properties added out of order
const obj1 = {};
obj1.a = 1;
obj1.b = 2;

// ✅ Stable - all properties initialized at once
const obj2 = { a: 1, b: 2 };

// ✅ Use helper
import { createStableObject } from '@core/v8-optimizations';
const obj3 = createStableObject({ a: 1, b: 2 });
```

### 3. Avoid Deoptimization Triggers
```typescript
// Common triggers:
// - try/catch in hot paths
// - arguments object usage
// - with statements
// - debugger statements
// - eval()

// ❌ Deoptimizes
function hotPath(a, b) {
  try {
    return a + b;
  } catch (e) {
    return 0;
  }
}

// ✅ Optimized
function hotPath(a, b) {
  return a + b;
}
```

### 4. Mark Hot Functions
```typescript
import { V8Optimizer } from '@core/v8-optimizations';

function criticalPath() {
  // Performance-critical code
}

V8Optimizer.markHotFunction(criticalPath);
```

## Memory Optimization Strategies

### 1. Object Pooling
```typescript
class ObjectPool<T> {
  private pool: T[] = [];
  
  acquire(): T | undefined {
    return this.pool.pop();
  }
  
  release(obj: T): void {
    this.pool.push(obj);
  }
}

// Use for frequently created/destroyed objects
const bufferPool = new ObjectPool<Buffer>();
```

### 2. Minimize Allocations in Hot Paths
```typescript
// ❌ Allocates on every call
function process(data: number[]) {
  const temp = new Array(100);
  // ... process
}

// ✅ Reuse allocation
const tempBuffer = new Array(100);
function process(data: number[]) {
  // ... use tempBuffer
}
```

### 3. Monitor Memory Growth
```typescript
import { MemoryOptimizer } from '@core/memory-optimizer';

// Start monitoring
const timer = MemoryOptimizer.startMonitoring(60000);

// Check for leaks periodically
setInterval(() => {
  const leaks = MemoryOptimizer.detectMemoryLeaks(10);
  if (leaks.length > 0) {
    console.warn('Memory leaks detected:', leaks);
  }
}, 300000);
```

## Performance Alerting Setup

### 1. Configure Alerts
```typescript
import { PerformanceAlerter } from '@monitoring/performance-alerts';

const alerter = new PerformanceAlerter({
  enabled: true,
  defaultCooldown: 300000, // 5 minutes
  notificationHandler: async (alert) => {
    // Send to monitoring system
    await sendToSlack({
      channel: '#performance-alerts',
      message: `${alert.severity}: ${alert.message}`,
    });
  },
});

// Add custom rule
alerter.addRule({
  name: 'custom-threshold',
  condition: (m) => m.latencyP99 > 15,
  severity: 'critical',
  cooldown: 120000,
});
```

### 2. Integrate with Monitoring
```typescript
// In your request handler
const metrics = {
  latencyP99: calculateP99(),
  rps: calculateRPS(),
  errorRate: calculateErrorRate(),
  // ... other metrics
};

const alerts = alerter.checkAlerts(metrics);
```

## Auto-Tuning Configuration

### 1. Start Auto-Tuning
```typescript
import { AutoTuner } from '@config/auto-tuner';

const tuner = new AutoTuner({
  enabled: true,
  observationWindow: 600000, // 10 minutes
  minObservations: 10,
  safeMode: true, // Start with recommendations only
  aggressiveness: 'moderate',
});

tuner.startTuning();
```

### 2. Record Load Patterns
```typescript
// Periodically record current state
setInterval(() => {
  tuner.recordLoadPattern({
    avgRPS: getCurrentRPS(),
    peakRPS: getPeakRPS(),
    avgLatency: getAvgLatency(),
    p99Latency: getP99Latency(),
    errorRate: getErrorRate(),
    memoryUsage: process.memoryUsage().heapUsed,
    cpuUsage: getCPUUsage(),
    activeConnections: getActiveConnections(),
  });
}, 60000); // Every minute
```

### 3. Apply Recommendations
```typescript
// Get recommendations
const recommendations = tuner.getRecommendations();

// Review and apply
for (const rec of recommendations) {
  if (rec.confidence > 0.8 && rec.impact === 'high') {
    console.log(`Applying: ${rec.parameter} ${rec.currentValue} -> ${rec.recommendedValue}`);
    tuner.updateParameter(rec.parameter, rec.recommendedValue);
  }
}
```

## Common Performance Issues

### Issue 1: High P99 Latency
**Symptoms**: P99 > 10ms, spiky latency
**Diagnosis**:
```typescript
import { CPUProfiler } from '@profiling/cpu-profiler';

const profiler = createCPUProfiler();
await profiler.startProfiling(30000); // 30 seconds
const result = await profiler.stopProfiling();
const analysis = profiler.analyzeProfile(result);

// Check hot functions
console.log('Hot functions:', analysis.hotFunctions);
```

**Solutions**:
- Optimize hot functions
- Reduce algorithmic complexity
- Add caching
- Use object pooling

### Issue 2: Memory Leak
**Symptoms**: Heap growing over time, increasing GC pauses
**Diagnosis**:
```typescript
import { MemoryOptimizer } from '@core/memory-optimizer';

const analysis = await MemoryOptimizer.analyzeHeapGrowth(60000, 300000);
if (analysis.isLeaking) {
  console.log('Leak detected:', analysis.suspiciousObjects);
  await MemoryOptimizer.takeHeapSnapshot();
}
```

**Solutions**:
- Review event listener cleanup
- Check cache eviction policies
- Verify connection cleanup
- Use WeakMap/WeakSet for caches

### Issue 3: Low RPS
**Symptoms**: Cannot reach target throughput
**Diagnosis**:
```typescript
// Check system metrics
const tuner = new AutoTuner({ ... });
tuner.startTuning();

// Let it observe
setTimeout(() => {
  const recommendations = tuner.getRecommendations();
  console.log('Tuning recommendations:', recommendations);
}, 600000);
```

**Solutions**:
- Increase worker count
- Optimize connection pooling
- Reduce per-request overhead
- Enable keep-alive
- Optimize middleware chain

## Production Checklist

### Before Deployment
- [ ] Enable performance dashboard
- [ ] Configure alert notifications
- [ ] Set up auto-tuning in safe mode
- [ ] Establish baseline metrics
- [ ] Configure logging levels
- [ ] Set up heap snapshot retention

### After Deployment
- [ ] Monitor P99 latency
- [ ] Track memory growth
- [ ] Review alert patterns
- [ ] Analyze auto-tuning recommendations
- [ ] Profile under load
- [ ] Capture representative heap snapshots

### Regular Maintenance
- [ ] Weekly: Review performance trends
- [ ] Monthly: Optimize based on data
- [ ] Quarterly: Conduct load tests
- [ ] Annually: Major performance audit

## Summary

Following these optimization guidelines will help maintain sub-10ms P99 latency at 150k+ RPS:

1. **Minimize allocations** in hot paths
2. **Keep functions monomorphic** for V8 optimization
3. **Monitor continuously** with dashboard and alerts
4. **Use profiling** to identify bottlenecks
5. **Let auto-tuning** optimize configuration
6. **Regular maintenance** to catch issues early
