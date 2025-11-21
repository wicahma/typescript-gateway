/**
 * Context pool performance benchmark
 * Tests context acquisition/release performance and pool efficiency
 * 
 * Target: > 95% pool hit rate under normal load
 */

import { ContextPool } from '../src/core/context.js';

const POOL_SIZE = 1000;
const ITERATIONS = 1_000_000;

console.log('=== Context Pool Performance Benchmark ===\n');

// Create pool
const pool = new ContextPool(POOL_SIZE);

console.log(`Pool Size: ${POOL_SIZE}`);
console.log(`Iterations: ${ITERATIONS.toLocaleString()}\n`);

// Benchmark 1: Acquire/Release Performance
console.log('1. Acquire/Release Performance (Pool Hits)');
let start = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  const ctx = pool.acquire();
  pool.release(ctx);
}
let end = process.hrtime.bigint();
let duration = Number(end - start) / 1_000_000; // Convert to ms
let opsPerSec = (ITERATIONS / duration) * 1000;
console.log(`   Duration:   ${duration.toFixed(2)}ms`);
console.log(`   Ops/sec:    ${opsPerSec.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
console.log(`   Avg time:   ${(duration / ITERATIONS * 1000).toFixed(3)}μs per acquire/release\n`);

// Benchmark 2: Pool Hit Rate
console.log('2. Pool Hit Rate Test');
const pool2 = new ContextPool(100);
const contexts2 = [];

// Simulate request handling with realistic pattern
// Acquire and release in batches to simulate concurrent requests
for (let i = 0; i < 500; i++) {
  // Acquire 10 contexts (simulating concurrent requests)
  const batch = [];
  for (let j = 0; j < 10; j++) {
    batch.push(pool2.acquire());
  }
  // Release all from batch (simulating request completion)
  for (const ctx of batch) {
    pool2.release(ctx);
  }
}

const metrics = pool2.metrics();
const hitRate = pool2.getHitRate();
console.log(`   Total acquired: ${metrics.totalAcquired.toLocaleString()}`);
console.log(`   Pool hits:      ${metrics.hits.toLocaleString()}`);
console.log(`   Pool misses:    ${metrics.misses.toLocaleString()}`);
console.log(`   Hit rate:       ${hitRate.toFixed(2)}%`);
console.log(`   Target:         > 95%`);
console.log(`   Status:         ${hitRate > 95 ? '✅ PASS' : '❌ FAIL'}\n`);

// Benchmark 3: Reset Performance
console.log('3. Context Reset Performance');
const ctx = pool.acquire();
ctx.requestId = 'test-123';
ctx.method = 'POST';
ctx.path = '/api/test';
ctx.query = { key: 'value' };
ctx.params = { id: '123' };
ctx.state = { user: { id: 1 }, session: 'abc' };

start = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  ctx.reset();
}
end = process.hrtime.bigint();
duration = Number(end - start) / 1_000_000;
opsPerSec = (ITERATIONS / duration) * 1000;
console.log(`   Duration:   ${duration.toFixed(2)}ms`);
console.log(`   Ops/sec:    ${opsPerSec.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
console.log(`   Avg time:   ${(duration / ITERATIONS * 1000).toFixed(3)}μs per reset\n`);

pool.release(ctx);

// Benchmark 4: High Concurrency Simulation
console.log('4. High Concurrency Simulation (10K concurrent)');
const pool3 = new ContextPool(1000);
const concurrentContexts = [];

start = process.hrtime.bigint();
// Acquire 10K contexts (simulating high concurrent load)
for (let i = 0; i < 10_000; i++) {
  concurrentContexts.push(pool3.acquire());
}
// Release all
for (const c of concurrentContexts) {
  pool3.release(c);
}
end = process.hrtime.bigint();
duration = Number(end - start) / 1_000_000;

const metrics3 = pool3.metrics();
const hitRate3 = pool3.getHitRate();
console.log(`   Duration:       ${duration.toFixed(2)}ms`);
console.log(`   Pool hits:      ${metrics3.hits.toLocaleString()}`);
console.log(`   Pool misses:    ${metrics3.misses.toLocaleString()}`);
console.log(`   Hit rate:       ${hitRate3.toFixed(2)}%`);
console.log(`   Status:         ${metrics3.misses < 10_000 ? '✅ PASS (pool handled overflow)' : '❌ FAIL'}\n`);

// Benchmark 5: Memory Efficiency
console.log('5. Memory Efficiency Test');
const memBefore = process.memoryUsage();
console.log(`   Memory before: ${(memBefore.heapUsed / 1024 / 1024).toFixed(2)} MB`);

// Create large pool and use it extensively
const largePool = new ContextPool(5000);
for (let i = 0; i < 100_000; i++) {
  const c = largePool.acquire();
  c.requestId = `req-${i}`;
  c.path = `/api/test/${i}`;
  largePool.release(c);
}

if (global.gc) {
  global.gc();
}

const memAfter = process.memoryUsage();
const memDiff = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;
console.log(`   Memory after:  ${(memAfter.heapUsed / 1024 / 1024).toFixed(2)} MB`);
console.log(`   Difference:    ${memDiff.toFixed(2)} MB`);
console.log(`   Status:        ${memDiff < 50 ? '✅ PASS (< 50MB)' : '⚠️  WARN (high memory)'}\n`);

console.log('=== Benchmark Complete ===');
