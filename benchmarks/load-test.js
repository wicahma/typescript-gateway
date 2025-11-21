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
  console.log(`  Average:       ${result.latency.mean.toFixed(2)}ms`);
  console.log(`  Median:        ${result.latency.p50.toFixed(2)}ms`);
  console.log(`  P95:           ${result.latency.p95.toFixed(2)}ms`);
  console.log(`  P99:           ${result.latency.p99.toFixed(2)}ms`);
  console.log(`  Max:           ${result.latency.max.toFixed(2)}ms`);
  console.log('');
  console.log('Requests/sec:');
  console.log(`  Average:       ${result.requests.average.toFixed(2)}`);
  console.log(`  Mean:          ${result.requests.mean.toFixed(2)}`);
  console.log('');
  console.log('Throughput:');
  console.log(`  Average:       ${(result.throughput.average / 1024 / 1024).toFixed(2)} MB/s`);
  console.log(`  Mean:          ${(result.throughput.mean / 1024 / 1024).toFixed(2)} MB/s`);
  console.log('');

  // Check if targets are met
  const targetsMetIcon = result.latency.p99 < 10 && result.requests.average > 10000 ? '✅' : '❌';
  console.log(`Performance targets: ${targetsMetIcon}`);
  console.log(`  P99 < 10ms:      ${result.latency.p99 < 10 ? '✅' : '❌'} (${result.latency.p99.toFixed(2)}ms)`);
  console.log(`  RPS > 10k:       ${result.requests.average > 10000 ? '✅' : '❌'} (${result.requests.average.toFixed(2)})`);
});

// Stream results to console
autocannon.track(instance, { renderProgressBar: true });

// Handle termination
process.once('SIGINT', () => {
  instance.stop();
});
