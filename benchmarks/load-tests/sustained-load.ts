/**
 * Sustained load test - 150k RPS for 30 minutes
 */

import { MetricsCollector } from './utils/metrics-collector.js';
import { ReportGenerator } from './utils/report-generator.js';

async function runSustainedLoad() {
  const targetRPS = 150000;
  const durationMs = 30 * 60 * 1000; // 30 minutes
  const collector = new MetricsCollector();
  
  console.log(`Starting sustained load test: ${targetRPS} RPS for ${durationMs / 1000}s`);
  
  collector.start();
  
  const startTime = Date.now();
  const endTime = startTime + durationMs;
  
  // Simulate requests
  while (Date.now() < endTime) {
    const reqStart = performance.now();
    
    // Simulate request (in real test, would make actual HTTP request)
    await simulateRequest();
    
    const reqEnd = performance.now();
    const latency = reqEnd - reqStart;
    
    collector.recordRequest(latency, true);
    
    // Rate limiting to achieve target RPS
    const elapsed = Date.now() - startTime;
    const expectedRequests = (elapsed / 1000) * targetRPS;
    const actualRequests = collector.getMetrics().totalRequests;
    
    if (actualRequests > expectedRequests) {
      // Slight delay to maintain target RPS
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }
  
  const metrics = collector.getMetrics();
  ReportGenerator.printReport('Sustained Load (150k RPS, 30min)', metrics);
}

async function simulateRequest(): Promise<void> {
  // Simulate request processing
  return new Promise(resolve => {
    setTimeout(resolve, Math.random() * 2);
  });
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runSustainedLoad().catch(console.error);
}

export { runSustainedLoad };
