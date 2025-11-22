/**
 * Metrics collector for load tests
 */

export interface LoadTestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rps: number;
  latency: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  duration: number;
  startTime: number;
  endTime: number;
}

export class MetricsCollector {
  private latencies: number[] = [];
  private successCount = 0;
  private failureCount = 0;
  private startTime = 0;

  start(): void {
    this.latencies = [];
    this.successCount = 0;
    this.failureCount = 0;
    this.startTime = Date.now();
  }

  recordRequest(latency: number, success: boolean): void {
    this.latencies.push(latency);
    if (success) {
      this.successCount++;
    } else {
      this.failureCount++;
    }
  }

  getMetrics(): LoadTestMetrics {
    const endTime = Date.now();
    const duration = (endTime - this.startTime) / 1000; // seconds
    
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const totalRequests = this.successCount + this.failureCount;
    
    return {
      totalRequests,
      successfulRequests: this.successCount,
      failedRequests: this.failureCount,
      rps: totalRequests / duration,
      latency: {
        min: sorted[0] || 0,
        max: sorted[sorted.length - 1] || 0,
        avg: sorted.reduce((a, b) => a + b, 0) / sorted.length || 0,
        p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
        p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
        p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
      },
      duration,
      startTime: this.startTime,
      endTime,
    };
  }

  reset(): void {
    this.latencies = [];
    this.successCount = 0;
    this.failureCount = 0;
    this.startTime = 0;
  }
}
