/**
 * Load testing script using autocannon
 * Benchmarks gateway performance
 */

import autocannon from 'autocannon';

const url = process.env.GATEWAY_URL || 'http://localhost:3000';
const duration = parseInt(process.env.DURATION || '30', 10);
const connections = parseInt(process.env.CONNECTIONS || '100', 10);

console.log('Starting load test...');
console.log(`URL: ${url}`);
console.log(`Duration: ${duration}s`);
console.log(`Connections: ${connections}`);
console.log('');

const instance = autocannon({
  url,
  connections,
  duration,
  pipelining: 1,
  title: 'TypeScript Gateway Load Test'
}, (err, result) => {
  if (err) {
    console.error('Load test failed:', err);
    process.exit(1);
  }

  console.log('');
  console.log('=== Load Test Results ===');
  console.log('');
  console.log(`Requests:        ${result.requests.total}`);
  console.log(`Duration:        ${result.duration}s`);
  console.log(`Throughput:      ${result.throughput.total} bytes`);
  console.log('');
  console.log('Latency:');
  console.log(`  Average:       ${(result.latency.mean ?? 0).toFixed(2)}ms`);
  console.log(`  Median:        ${(result.latency.p50 ?? result.latency.min ?? 0).toFixed(2)}ms`);
  console.log(`  P97.5:         ${(result.latency.p97_5 ?? result.latency.p90 ?? 0).toFixed(2)}ms`);
  console.log(`  P99:           ${(result.latency.p99 ?? 0).toFixed(2)}ms`);
  console.log(`  Max:           ${(result.latency.max ?? 0).toFixed(2)}ms`);
  console.log('');
  console.log('Requests/sec:');
  console.log(`  Average:       ${(result.requests.average ?? 0).toFixed(2)}`);
  console.log(`  Mean:          ${(result.requests.mean ?? 0).toFixed(2)}`);
  console.log('');
  console.log('Throughput:');
  console.log(`  Average:       ${((result.throughput.average ?? 0) / 1024 / 1024).toFixed(2)} MB/s`);
  console.log(`  Mean:          ${((result.throughput.mean ?? 0) / 1024 / 1024).toFixed(2)} MB/s`);
  console.log('');

  // Check if targets are met
  const p99 = result.latency.p99 ?? 0;
  const avgReq = result.requests.average ?? 0;
  const targetsMetIcon = p99 < 10 && avgReq > 10000 ? '✅' : '❌';
  console.log(`Performance targets: ${targetsMetIcon}`);
  console.log(`  P99 < 10ms:      ${p99 > 0 && p99 < 10 ? '✅' : '❌'} (${p99.toFixed(2)}ms)`);
  console.log(`  RPS > 10k:       ${avgReq > 10000 ? '✅' : '❌'} (${avgReq.toFixed(2)})`);
});

// Stream results to console
autocannon.track(instance, { renderProgressBar: true });

// Handle termination
process.once('SIGINT', () => {
  instance.stop();
});
