/**
 * Report generator for load tests
 */

import { LoadTestMetrics } from './metrics-collector.js';
import { writeFile } from 'fs/promises';

export class ReportGenerator {
  static generateReport(testName: string, metrics: LoadTestMetrics): string {
    const report = [
      `# Load Test Report: ${testName}`,
      ``,
      `## Summary`,
      `- **Duration**: ${metrics.duration.toFixed(2)}s`,
      `- **Total Requests**: ${metrics.totalRequests}`,
      `- **Successful**: ${metrics.successfulRequests}`,
      `- **Failed**: ${metrics.failedRequests}`,
      `- **Success Rate**: ${((metrics.successfulRequests / metrics.totalRequests) * 100).toFixed(2)}%`,
      `- **RPS**: ${metrics.rps.toFixed(2)} req/s`,
      ``,
      `## Latency Statistics`,
      `- **Min**: ${metrics.latency.min.toFixed(2)}ms`,
      `- **Max**: ${metrics.latency.max.toFixed(2)}ms`,
      `- **Avg**: ${metrics.latency.avg.toFixed(2)}ms`,
      `- **P50**: ${metrics.latency.p50.toFixed(2)}ms`,
      `- **P95**: ${metrics.latency.p95.toFixed(2)}ms`,
      `- **P99**: ${metrics.latency.p99.toFixed(2)}ms`,
      ``,
      `## Performance Targets`,
      `- **P50 < 1ms**: ${metrics.latency.p50 < 1 ? '✅ PASS' : '❌ FAIL'}`,
      `- **P95 < 5ms**: ${metrics.latency.p95 < 5 ? '✅ PASS' : '❌ FAIL'}`,
      `- **P99 < 10ms**: ${metrics.latency.p99 < 10 ? '✅ PASS' : '❌ FAIL'}`,
      `- **RPS > 10000**: ${metrics.rps > 10000 ? '✅ PASS' : '❌ FAIL'}`,
      ``,
    ].join('\n');

    return report;
  }

  static async saveReport(
    testName: string,
    metrics: LoadTestMetrics,
    outputPath: string
  ): Promise<void> {
    const report = this.generateReport(testName, metrics);
    await writeFile(outputPath, report);
  }

  static printReport(testName: string, metrics: LoadTestMetrics): void {
    const report = this.generateReport(testName, metrics);
    console.log(report);
  }
}
