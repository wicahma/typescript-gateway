# Phase 9: Profiling Guide

## CPU Profiling

### When to Profile
- High CPU usage (>80%)
- High P99 latency
- Before/after optimizations
- Investigating performance regressions

### Basic CPU Profiling
```typescript
import { createCPUProfiler } from '@profiling/cpu-profiler';

const profiler = createCPUProfiler({
  samplingInterval: 1000, // 1ms
  maxSamples: 10000,
  includeNative: false,
});

// Start profiling
await profiler.startProfiling(30000); // 30 seconds

// Stop and analyze
const result = await profiler.stopProfiling();
const analysis = profiler.analyzeProfile(result);

console.log('Hot functions:', analysis.hotFunctions);
```

### Sampling-Based Profiling
```typescript
// Lower overhead for production
profiler.startSampling(100); // Sample every 100ms

// Let it run...
setTimeout(() => {
  const result = profiler.stopSampling();
  console.log(`Captured ${result.totalSamples} samples`);
}, 60000);
```

### Generate Flame Graph
```typescript
const profile = await profiler.stopProfiling();
await profiler.generateFlameGraph(profile, './flamegraph.txt');

// Use flamegraph.pl to visualize:
// flamegraph.pl flamegraph.txt > flamegraph.svg
```

## Memory Profiling

### Take Heap Snapshots
```typescript
import { MemoryOptimizer } from '@core/memory-optimizer';

// Take snapshot
await MemoryOptimizer.takeHeapSnapshot('./snapshot-1.heapsnapshot');

// Wait and take another
await new Promise(resolve => setTimeout(resolve, 300000)); // 5 min
await MemoryOptimizer.takeHeapSnapshot('./snapshot-2.heapsnapshot');

// Compare in Chrome DevTools
```

### Analyze Heap Growth
```typescript
const analysis = await MemoryOptimizer.analyzeHeapGrowth(
  60000,  // Sample every minute
  600000  // For 10 minutes
);

console.log(`Growth rate: ${analysis.averageGrowthRate} MB/hour`);
console.log(`Leaking: ${analysis.isLeaking}`);
console.log(`Suspicious: ${analysis.suspiciousObjects}`);
```

### Detect Memory Leaks
```typescript
// Populate history first
for (let i = 0; i < 20; i++) {
  MemoryOptimizer.getMemoryStats();
  await new Promise(resolve => setTimeout(resolve, 10000));
}

// Check for leaks
const leaks = MemoryOptimizer.detectMemoryLeaks(10); // >10MB/hour threshold

if (leaks.length > 0) {
  console.warn('Leaks detected:', leaks);
  await MemoryOptimizer.takeHeapSnapshot();
}
```

### Monitor GC Events
```typescript
import { createMemoryProfiler } from '@profiling/memory-profiler';

const profiler = createMemoryProfiler();
const monitor = profiler.monitorGC();

monitor.start();

// Let it collect data...
setTimeout(() => {
  monitor.stop();
  const stats = monitor.getStats();
  console.log(`GC events: ${stats.totalEvents}`);
  console.log(`Avg duration: ${stats.averageDuration}ms`);
  console.log(`Max duration: ${stats.maxDuration}ms`);
}, 60000);
```

## V8 Optimization Analysis

### Check Function Optimization
```typescript
import { V8Optimizer } from '@core/v8-optimizations';

function criticalFunction(a: number, b: number) {
  return a + b;
}

// Warm up
for (let i = 0; i < 10000; i++) {
  criticalFunction(i, i + 1);
}

// Check status
const status = V8Optimizer.getOptimizationStatus(criticalFunction);
console.log(`Optimized: ${status.isOptimized}`);
console.log(`Tier: ${status.tier}`);
console.log(`Deopts: ${status.deoptimizations}`);
```

### Analyze Object Shapes
```typescript
const obj = { x: 1, y: 2, z: 3 };
const analysis = V8Optimizer.analyzeObjectShape(obj);

console.log(`Properties: ${analysis.properties}`);
console.log(`Hidden class: ${analysis.hiddenClass}`);
console.log(`Stable: ${analysis.isStable}`);
```

### Track Deoptimizations
```typescript
// Record deopt
V8Optimizer.recordDeoptimization('myFunction', 'type changed');

// Check history
const deopts = V8Optimizer.checkDeoptimizations();
console.log('Recent deoptimizations:', deopts);
```

### Detect Polymorphism
```typescript
import { polymorphismDetector } from '@core/v8-optimizations';

function processValue(value: any) {
  polymorphismDetector.trackType('processValue', typeof value);
  return value;
}

// Use with different types
processValue(42);
processValue('string');
processValue({});

// Get report
const report = polymorphismDetector.getReport();
for (const [site, typeCount] of report) {
  if (typeCount > 4) {
    console.warn(`High polymorphism at ${site}: ${typeCount} types`);
  }
}
```

## Performance Dashboard Usage

### Start Dashboard
```typescript
import { PerformanceDashboard } from '@monitoring/performance-dashboard';

const dashboard = new PerformanceDashboard();
await dashboard.start(3000);

console.log('Dashboard available at http://localhost:3000');
```

### Update Metrics
```typescript
setInterval(() => {
  dashboard.updateMetrics({
    timestamp: Date.now(),
    latency: {
      p50: calculateP50(),
      p95: calculateP95(),
      p99: calculateP99(),
    },
    throughput: calculateRPS(),
    errorRate: calculateErrorRate(),
    memoryUsage: process.memoryUsage().heapUsed,
  });
}, 1000);
```

### Query Historical Data
```typescript
const historical = dashboard.getHistoricalMetrics({
  from: Date.now() - 3600000, // Last hour
  to: Date.now(),
});

console.log(`Avg P99: ${historical.aggregates.avgLatencyP99}ms`);
console.log(`Max P99: ${historical.aggregates.maxLatencyP99}ms`);
```

## Production Profiling Best Practices

### 1. Minimize Overhead
- Use sampling (not continuous) profiling
- Profile for short periods (30-60 seconds)
- Schedule during low-traffic periods
- Monitor overhead with performance tests

### 2. Safe Profiling
```typescript
// Wrap in try-catch
async function safeProfile() {
  try {
    const profiler = createCPUProfiler();
    await profiler.startProfiling(30000);
    const result = await profiler.stopProfiling();
    return profiler.analyzeProfile(result);
  } catch (error) {
    console.error('Profiling failed:', error);
    return null;
  }
}
```

### 3. Automated Profiling
```typescript
// Profile automatically on high latency
setInterval(() => {
  const p99 = getP99Latency();
  
  if (p99 > 15 && !currentlyProfiling) {
    console.log('High latency detected, starting profile');
    startAutomaticProfile().catch(console.error);
  }
}, 60000);
```

### 4. Snapshot Management
```typescript
// Clean up old snapshots
const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
setInterval(async () => {
  await MemoryOptimizer.cleanupSnapshots();
}, TWO_WEEKS);
```

## Interpreting Results

### CPU Profile Analysis
Look for:
- Functions with high self-time (hot spots)
- Deep call stacks (recursive issues)
- Unexpected native code (library issues)
- Inefficient algorithms

### Memory Profile Analysis
Look for:
- Continuously growing heap
- Large object counts
- Retained DOM nodes (if applicable)
- Detached contexts
- Large arrays/buffers

### V8 Optimization Analysis
Look for:
- Deoptimized hot functions
- Polymorphic call sites
- Unstable object shapes
- Hidden class transitions

## Troubleshooting

### Profile Not Capturing Data
```typescript
// Ensure workload is running
// Increase profiling duration
// Check sampling interval
const profiler = createCPUProfiler({
  samplingInterval: 100, // Increase for more samples
  maxSamples: 50000,     // Increase limit
});
```

### High Memory After Profiling
```typescript
// Explicitly clear references
profiler = null;
if (global.gc) {
  global.gc();
}
```

### Dashboard Not Updating
```typescript
// Check SSE connection
// Verify metrics are being sent
// Check browser console for errors
const clientCount = dashboard.getConnectedClients();
console.log(`Connected clients: ${clientCount}`);
```

## Summary

Effective profiling workflow:
1. **Baseline**: Establish normal performance
2. **Detect**: Use alerts to identify issues
3. **Profile**: Capture detailed data
4. **Analyze**: Identify root causes
5. **Optimize**: Implement fixes
6. **Validate**: Verify improvements
7. **Monitor**: Ensure sustained performance
