/**
 * Memory optimization utilities for production monitoring
 * Phase 9: Advanced memory management and leak detection
 */

import { writeHeapSnapshot } from 'v8';
import { memoryUsage } from 'process';
import { performance } from 'perf_hooks';
import { writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Memory statistics
 */
export interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
}

/**
 * Heap growth analysis result
 */
export interface HeapGrowthAnalysis {
  averageGrowthRate: number; // MB/hour
  isLeaking: boolean;
  suspiciousObjects: string[];
  startTime: number;
  endTime: number;
  samples: MemoryStats[];
}

/**
 * Memory leak report
 */
export interface LeakReport {
  type: 'suspected' | 'confirmed';
  description: string;
  growthRate: number; // MB/hour
  startTime: number;
  detectedAt: number;
  samples: MemoryStats[];
}

/**
 * GC statistics
 */
export interface GCStats {
  count: number;
  totalTime: number;
  averageTime: number;
  lastGCTime: number;
}

/**
 * Memory optimizer class
 */
export class MemoryOptimizer {
  private static heapSnapshots: string[] = [];
  private static memoryHistory: Array<{ timestamp: number; stats: MemoryStats }> = [];
  private static gcStats: GCStats = {
    count: 0,
    totalTime: 0,
    averageTime: 0,
    lastGCTime: 0,
  };

  /**
   * Take heap snapshot for analysis
   */
  static async takeHeapSnapshot(filename?: string): Promise<void> {
    const timestamp = Date.now();
    const snapshotFile = filename || join(
      process.cwd(),
      'heapdumps',
      `heap-${timestamp}.heapsnapshot`
    );

    try {
      // Ensure directory exists
      const { mkdir } = await import('fs/promises');
      const { dirname } = await import('path');
      await mkdir(dirname(snapshotFile), { recursive: true });

      // Take snapshot
      writeHeapSnapshot(snapshotFile);
      this.heapSnapshots.push(snapshotFile);

      // Keep only last 10 snapshots reference
      if (this.heapSnapshots.length > 10) {
        this.heapSnapshots.shift();
      }
    } catch (error) {
      console.error('Failed to take heap snapshot:', error);
      throw error;
    }
  }

  /**
   * Analyze heap growth over time
   */
  static async analyzeHeapGrowth(
    interval: number,
    duration: number
  ): Promise<HeapGrowthAnalysis> {
    const samples: MemoryStats[] = [];
    const startTime = Date.now();
    const endTime = startTime + duration;
    const sampleCount = Math.floor(duration / interval);

    // Collect samples
    for (let i = 0; i < sampleCount; i++) {
      samples.push(this.getMemoryStats());
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    // Calculate growth rate
    if (samples.length < 2) {
      throw new Error('Need at least 2 samples to analyze growth');
    }

    const firstHeap = samples[0]!.heapUsed;
    const lastHeap = samples[samples.length - 1]!.heapUsed;
    const timeDiff = (endTime - startTime) / (1000 * 60 * 60); // hours
    const heapDiff = (lastHeap - firstHeap) / (1024 * 1024); // MB
    const averageGrowthRate = heapDiff / timeDiff;

    // Detect if leaking (> 10 MB/hour sustained growth)
    const isLeaking = averageGrowthRate > 10;

    // Identify suspicious patterns
    const suspiciousObjects: string[] = [];
    if (isLeaking) {
      suspiciousObjects.push('Heap growing consistently');
      
      // Check if external memory is growing
      const firstExternal = samples[0]!.external;
      const lastExternal = samples[samples.length - 1]!.external;
      if (lastExternal > firstExternal * 1.5) {
        suspiciousObjects.push('External memory growing');
      }

      // Check array buffers
      const firstBuffers = samples[0]!.arrayBuffers;
      const lastBuffers = samples[samples.length - 1]!.arrayBuffers;
      if (lastBuffers > firstBuffers * 1.5) {
        suspiciousObjects.push('Array buffers accumulating');
      }
    }

    return {
      averageGrowthRate,
      isLeaking,
      suspiciousObjects,
      startTime,
      endTime,
      samples,
    };
  }

  /**
   * Optimize GC strategy for workload
   */
  static optimizeGCStrategy(workloadType: 'latency' | 'throughput'): void {
    // Set GC flags based on workload
    // Note: These would typically be set at Node.js startup via command-line flags
    // This method documents the recommended settings
    
    const recommendations: Record<string, string[]> = {
      latency: [
        '--max-old-space-size=2048',
        '--max-semi-space-size=64',
        '--optimize-for-size',
        '--gc-interval=1000',
      ],
      throughput: [
        '--max-old-space-size=4096',
        '--max-semi-space-size=128',
        '--no-optimize-for-size',
        '--gc-interval=2000',
      ],
    };

    const flags = recommendations[workloadType] || recommendations['latency'];
    
    if (flags) {
      console.log(`GC optimization recommendations for ${workloadType}:`);
      console.log(flags.join(' '));
      console.log('\nNote: Apply these flags when starting Node.js:');
      console.log(`node ${flags.join(' ')} your-app.js`);
    }
  }

  /**
   * Detect memory leaks automatically
   */
  static detectMemoryLeaks(threshold: number = 10): LeakReport[] {
    const reports: LeakReport[] = [];
    const recentHistory = this.memoryHistory.slice(-100); // Last 100 samples

    if (recentHistory.length < 10) {
      return reports; // Not enough data
    }

    // Analyze trend
    const firstSamples = recentHistory.slice(0, 5);
    const lastSamples = recentHistory.slice(-5);

    const avgFirst = firstSamples.reduce((sum, s) => sum + s.stats.heapUsed, 0) / 5;
    const avgLast = lastSamples.reduce((sum, s) => sum + s.stats.heapUsed, 0) / 5;

    const firstTime = firstSamples[0]?.timestamp || Date.now();
    const lastTime = lastSamples[lastSamples.length - 1]?.timestamp || Date.now();
    const timeDiffHours = (lastTime - firstTime) / (1000 * 60 * 60);

    if (timeDiffHours > 0) {
      const growthMB = (avgLast - avgFirst) / (1024 * 1024);
      const growthRate = growthMB / timeDiffHours;

      if (growthRate > threshold) {
        reports.push({
          type: growthRate > threshold * 2 ? 'confirmed' : 'suspected',
          description: `Heap growing at ${growthRate.toFixed(2)} MB/hour`,
          growthRate,
          startTime: firstTime,
          detectedAt: Date.now(),
          samples: recentHistory.map(h => h.stats),
        });
      }
    }

    return reports;
  }

  /**
   * Get current memory usage statistics
   */
  static getMemoryStats(): MemoryStats {
    const mem = memoryUsage();
    
    const stats: MemoryStats = {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      rss: mem.rss,
    };

    // Store in history
    this.memoryHistory.push({
      timestamp: Date.now(),
      stats,
    });

    // Keep last 1000 samples
    if (this.memoryHistory.length > 1000) {
      this.memoryHistory.shift();
    }

    return stats;
  }

  /**
   * Format memory stats for display
   */
  static formatMemoryStats(stats: MemoryStats): string {
    const formatMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    
    return [
      `Heap Used: ${formatMB(stats.heapUsed)}`,
      `Heap Total: ${formatMB(stats.heapTotal)}`,
      `External: ${formatMB(stats.external)}`,
      `Array Buffers: ${formatMB(stats.arrayBuffers)}`,
      `RSS: ${formatMB(stats.rss)}`,
    ].join(', ');
  }

  /**
   * Get memory history
   */
  static getMemoryHistory(): Array<{ timestamp: number; stats: MemoryStats }> {
    return [...this.memoryHistory];
  }

  /**
   * Clear memory history
   */
  static clearHistory(): void {
    this.memoryHistory = [];
  }

  /**
   * Force garbage collection (requires --expose-gc flag)
   */
  static forceGC(): void {
    if (global.gc) {
      const start = performance.now();
      global.gc();
      const duration = performance.now() - start;
      
      this.gcStats.count++;
      this.gcStats.totalTime += duration;
      this.gcStats.averageTime = this.gcStats.totalTime / this.gcStats.count;
      this.gcStats.lastGCTime = duration;
    } else {
      console.warn('GC not exposed. Start Node.js with --expose-gc flag.');
    }
  }

  /**
   * Get GC statistics
   */
  static getGCStats(): GCStats {
    return { ...this.gcStats };
  }

  /**
   * Start periodic memory monitoring
   */
  static startMonitoring(interval: number = 10000): NodeJS.Timeout {
    return setInterval(() => {
      this.getMemoryStats();
      
      // Check for leaks periodically
      const leaks = this.detectMemoryLeaks();
      if (leaks.length > 0) {
        console.warn('Memory leak detected:', leaks);
      }
    }, interval);
  }

  /**
   * Stop monitoring
   */
  static stopMonitoring(timer: NodeJS.Timeout): void {
    clearInterval(timer);
  }

  /**
   * Generate memory report
   */
  static async generateReport(outputPath?: string): Promise<string> {
    const stats = this.getMemoryStats();
    const leaks = this.detectMemoryLeaks();
    const gcStats = this.getGCStats();

    const report = {
      timestamp: new Date().toISOString(),
      memory: {
        current: stats,
        formatted: this.formatMemoryStats(stats),
      },
      gc: gcStats,
      leaks: leaks,
      history: this.memoryHistory.slice(-100),
      snapshots: this.heapSnapshots,
    };

    const reportJson = JSON.stringify(report, null, 2);

    if (outputPath) {
      await writeFile(outputPath, reportJson);
    }

    return reportJson;
  }

  /**
   * Get recommendations based on current memory usage
   */
  static getRecommendations(): string[] {
    const stats = this.getMemoryStats();
    const recommendations: string[] = [];

    const heapUsagePercent = (stats.heapUsed / stats.heapTotal) * 100;

    if (heapUsagePercent > 90) {
      recommendations.push('Heap usage very high (>90%). Consider increasing --max-old-space-size');
    } else if (heapUsagePercent > 80) {
      recommendations.push('Heap usage high (>80%). Monitor for memory leaks');
    }

    const externalPercent = (stats.external / stats.heapTotal) * 100;
    if (externalPercent > 50) {
      recommendations.push('High external memory usage. Check for large buffers or native modules');
    }

    const leaks = this.detectMemoryLeaks();
    if (leaks.length > 0) {
      recommendations.push(`${leaks.length} potential memory leak(s) detected. Take heap snapshot for analysis`);
    }

    if (this.gcStats.averageTime > 50) {
      recommendations.push('Average GC pause > 50ms. Consider optimizing object lifecycle');
    }

    return recommendations;
  }
}
