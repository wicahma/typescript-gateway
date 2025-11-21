/**
 * Router performance benchmark
 * Tests route matching performance for static and dynamic routes
 * 
 * Target: > 1M ops/sec for static routes, > 500K ops/sec for dynamic routes
 */

import { Router } from '../src/core/router.js';

const ITERATIONS = 1_000_000;

// Setup router with test routes
const router = new Router();

// Static routes (O(1))
router.register('GET', '/api/health', async () => {});
router.register('GET', '/api/metrics', async () => {});
router.register('GET', '/api/status', async () => {});
router.register('POST', '/api/users', async () => {});
router.register('GET', '/api/users/list', async () => {});

// Dynamic routes (O(log n))
router.register('GET', '/api/users/:id', async () => {});
router.register('GET', '/api/users/:id/profile', async () => {});
router.register('GET', '/api/users/:userId/posts/:postId', async () => {});
router.register('GET', '/api/v:version/users/:id', async () => {});

// Wildcard route
router.register('GET', '/api/*', async () => {});

console.log('=== Router Performance Benchmark ===\n');

// Benchmark static route matching
console.log('1. Static Route Matching (O(1))');
let start = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  router.match('GET', '/api/health');
}
let end = process.hrtime.bigint();
let duration = Number(end - start) / 1_000_000; // Convert to ms
let opsPerSec = (ITERATIONS / duration) * 1000;
console.log(`   Iterations: ${ITERATIONS.toLocaleString()}`);
console.log(`   Duration:   ${duration.toFixed(2)}ms`);
console.log(`   Ops/sec:    ${opsPerSec.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
console.log(`   Target:     > 1,000,000 ops/sec`);
console.log(`   Status:     ${opsPerSec > 1_000_000 ? '✅ PASS' : '❌ FAIL'}\n`);

// Benchmark dynamic route matching (single param)
console.log('2. Dynamic Route Matching - Single Parameter (O(log n))');
start = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  router.match('GET', '/api/users/12345');
}
end = process.hrtime.bigint();
duration = Number(end - start) / 1_000_000;
opsPerSec = (ITERATIONS / duration) * 1000;
console.log(`   Iterations: ${ITERATIONS.toLocaleString()}`);
console.log(`   Duration:   ${duration.toFixed(2)}ms`);
console.log(`   Ops/sec:    ${opsPerSec.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
console.log(`   Target:     > 500,000 ops/sec`);
console.log(`   Status:     ${opsPerSec > 500_000 ? '✅ PASS' : '❌ FAIL'}\n`);

// Benchmark dynamic route matching (multiple params)
console.log('3. Dynamic Route Matching - Multiple Parameters (O(log n))');
start = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  router.match('GET', '/api/users/123/posts/456');
}
end = process.hrtime.bigint();
duration = Number(end - start) / 1_000_000;
opsPerSec = (ITERATIONS / duration) * 1000;
console.log(`   Iterations: ${ITERATIONS.toLocaleString()}`);
console.log(`   Duration:   ${duration.toFixed(2)}ms`);
console.log(`   Ops/sec:    ${opsPerSec.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
console.log(`   Target:     > 500,000 ops/sec`);
console.log(`   Status:     ${opsPerSec > 500_000 ? '✅ PASS' : '❌ FAIL'}\n`);

// Benchmark route not found
console.log('4. Route Not Found (fallthrough to null)');
start = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  router.match('GET', '/nonexistent/route');
}
end = process.hrtime.bigint();
duration = Number(end - start) / 1_000_000;
opsPerSec = (ITERATIONS / duration) * 1000;
console.log(`   Iterations: ${ITERATIONS.toLocaleString()}`);
console.log(`   Duration:   ${duration.toFixed(2)}ms`);
console.log(`   Ops/sec:    ${opsPerSec.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
console.log(`   Status:     ✅ INFO (no target)\n`);

// Memory test
console.log('5. Memory Stability Test');
const memBefore = process.memoryUsage();
console.log(`   Memory before: ${(memBefore.heapUsed / 1024 / 1024).toFixed(2)} MB`);

// Perform many operations
for (let i = 0; i < 10_000_000; i++) {
  router.match('GET', '/api/health');
  router.match('GET', '/api/users/123');
}

if (global.gc) {
  global.gc();
}

const memAfter = process.memoryUsage();
console.log(`   Memory after:  ${(memAfter.heapUsed / 1024 / 1024).toFixed(2)} MB`);
console.log(`   Difference:    ${((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2)} MB`);
console.log(`   Status:        ${Math.abs(memAfter.heapUsed - memBefore.heapUsed) < 10 * 1024 * 1024 ? '✅ PASS (< 10MB leak)' : '⚠️  WARN (possible leak)'}\n`);

console.log('=== Benchmark Complete ===');
