/**
 * Memory profiling system for leak detection and analysis
 * Phase 9: Comprehensive memory profiling tools
 */

import { writeHeapSnapshot } from 'v8';
import { join } from 'path';

/**
 * Memory profiler configuration
 */
export interface MemoryProfilerConfig {
  snapshotPath: string;
  retentionDays: number;
  autoSnapshot: boolean;
  autoSnapshotInterval: number; // milliseconds
}

/**
 * Heap snapshot reference
 */
export interface Snapshot {
  id: string;
  timestamp: number;
  path: string;
  size: number;
  heapUsed: number;
}

/**
 * Snapshot comparison result
 */
export interface Comparison {
  snapshot1: Snapshot;
  snapshot2: Snapshot;
  timeDelta: number;
  heapGrowth: number;
  growthRate: number; // MB/hour
  suspectedLeaks: LeakSuspect[];
}

/**
 * Suspected memory leak
 */
export interface LeakSuspect {
  type: string;
  count: number;
  size: number;
  retainedSize: number;
}

/**
 * Allocation profile
 */
export interface AllocationProfile {
  allocations: Allocation[];
  totalAllocated: number;
  byType: Map<string, number>;
  startTime: number;
  endTime: number;
}

/**
 * Single allocation event
 */
export interface Allocation {
  timestamp: number;
  type: string;
  size: number;
  stackTrace: string;
}

/**
 * GC monitor interface
 */
export interface GCMonitor {
  start(): void;
  stop(): void;
  getEvents(): GCEvent[];
  getStats(): GCMonitorStats;
}

/**
 * GC event
 */
export interface GCEvent {
  timestamp: number;
  type: string;
  duration: number;
  heapBefore: number;
  heapAfter: number;
  freed: number;
}

/**
 * GC monitoring statistics
 */
export interface GCMonitorStats {
  totalEvents: number;
  totalTime: number;
  averageDuration: number;
  maxDuration: number;
  heapFreed: number;
}

/**
 * Retention tree for object analysis
 */
export interface RetentionTree {
  root: RetentionNode;
  totalRetained: number;
  largestRetainers: RetentionNode[];
}

/**
 * Retention tree node
 */
export interface RetentionNode {
  name: string;
  type: string;
  retainedSize: number;
  children: RetentionNode[];
}

/**
 * Memory profiler class
 */
export class MemoryProfiler {
  private config: MemoryProfilerConfig;
  private snapshots: Snapshot[] = [];
  private autoSnapshotTimer: NodeJS.Timeout | null = null;
  private allocations: Allocation[] = [];
  private gcMonitor: GCMonitorImpl | null = null;

  constructor(config: Partial<MemoryProfilerConfig> = {}) {
    this.config = {
      snapshotPath: config.snapshotPath || join(process.cwd(), 'heapdumps'),
      retentionDays: config.retentionDays || 7,
      autoSnapshot: config.autoSnapshot ?? false,
      autoSnapshotInterval: config.autoSnapshotInterval || 3600000, // 1 hour
    };

    if (this.config.autoSnapshot) {
      this.startAutoSnapshot();
    }
  }

  /**
   * Take heap snapshot
   */
  async takeSnapshot(): Promise<Snapshot> {
    const timestamp = Date.now();
    const id = `snapshot-${timestamp}`;
    const filename = `${id}.heapsnapshot`;
    const path = join(this.config.snapshotPath, filename);

    try {
      // Ensure directory exists
      const { mkdir } = await import('fs/promises');
      await mkdir(this.config.snapshotPath, { recursive: true });

      // Get current heap usage
      const heapUsed = process.memoryUsage().heapUsed;

      // Take snapshot
      writeHeapSnapshot(path);

      // Get file size
      const { stat } = await import('fs/promises');
      const stats = await stat(path);

      const snapshot: Snapshot = {
        id,
        timestamp,
        path,
        size: stats.size,
        heapUsed,
      };

      this.snapshots.push(snapshot);

      return snapshot;
    } catch (error) {
      console.error('Failed to take snapshot:', error);
      throw error;
    }
  }

  /**
   * Compare two snapshots to find leaks
   */
  compareSnapshots(snap1: Snapshot, snap2: Snapshot): Comparison {
    const timeDelta = snap2.timestamp - snap1.timestamp;
    const heapGrowth = snap2.heapUsed - snap1.heapUsed;
    const growthRate = (heapGrowth / (1024 * 1024)) / (timeDelta / (1000 * 60 * 60)); // MB/hour

    // In a real implementation, we would parse the heap snapshots
    // and identify objects that grew between snapshots
    // For now, we'll provide a simplified analysis

    const suspectedLeaks: LeakSuspect[] = [];

    if (heapGrowth > 10 * 1024 * 1024) { // 10MB growth
      suspectedLeaks.push({
        type: 'Unknown',
        count: 0,
        size: heapGrowth,
        retainedSize: heapGrowth,
      });
    }

    return {
      snapshot1: snap1,
      snapshot2: snap2,
      timeDelta,
      heapGrowth,
      growthRate,
      suspectedLeaks,
    };
  }

  /**
   * Track allocations over time
   */
  async trackAllocations(duration: number): Promise<AllocationProfile> {
    const startTime = Date.now();
    const endTime = startTime + duration;
    this.allocations = [];

    // Start tracking (simplified - would use V8 allocation profiler in production)
    const interval = setInterval(() => {
      // Sample memory state
      const mem = process.memoryUsage();
      this.allocations.push({
        timestamp: Date.now(),
        type: 'heap',
        size: mem.heapUsed,
        stackTrace: '',
      });
    }, 100);

    // Wait for duration
    await new Promise(resolve => setTimeout(resolve, duration));
    clearInterval(interval);

    // Analyze allocations
    const totalAllocated = this.allocations.reduce((sum, alloc) => sum + alloc.size, 0);
    const byType = new Map<string, number>();

    for (const alloc of this.allocations) {
      byType.set(alloc.type, (byType.get(alloc.type) || 0) + alloc.size);
    }

    return {
      allocations: this.allocations,
      totalAllocated,
      byType,
      startTime,
      endTime,
    };
  }

  /**
   * Monitor GC events
   */
  monitorGC(): GCMonitor {
    if (!this.gcMonitor) {
      this.gcMonitor = new GCMonitorImpl();
    }
    return this.gcMonitor;
  }

  /**
   * Analyze object retention
   */
  analyzeRetention(snapshot: Snapshot): RetentionTree {
    // Simplified implementation - real version would parse heap snapshot
    const root: RetentionNode = {
      name: 'Global',
      type: 'Global',
      retainedSize: snapshot.heapUsed,
      children: [],
    };

    return {
      root,
      totalRetained: snapshot.heapUsed,
      largestRetainers: [root],
    };
  }

  /**
   * Get all snapshots
   */
  getSnapshots(): Snapshot[] {
    return [...this.snapshots];
  }

  /**
   * Start automatic snapshot capture
   */
  startAutoSnapshot(): void {
    if (this.autoSnapshotTimer) {
      return;
    }

    this.autoSnapshotTimer = setInterval(() => {
      this.takeSnapshot().catch(console.error);
    }, this.config.autoSnapshotInterval);
  }

  /**
   * Stop automatic snapshot capture
   */
  stopAutoSnapshot(): void {
    if (this.autoSnapshotTimer) {
      clearInterval(this.autoSnapshotTimer);
      this.autoSnapshotTimer = null;
    }
  }

  /**
   * Clean up old snapshots
   */
  async cleanupSnapshots(): Promise<number> {
    const cutoffTime = Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000);
    const toDelete = this.snapshots.filter(s => s.timestamp < cutoffTime);

    for (const snapshot of toDelete) {
      try {
        const { unlink } = await import('fs/promises');
        await unlink(snapshot.path);
      } catch (error) {
        console.error(`Failed to delete snapshot ${snapshot.id}:`, error);
      }
    }

    this.snapshots = this.snapshots.filter(s => s.timestamp >= cutoffTime);

    return toDelete.length;
  }

  /**
   * Destroy profiler and cleanup
   */
  destroy(): void {
    this.stopAutoSnapshot();
    if (this.gcMonitor) {
      this.gcMonitor.stop();
    }
  }
}

/**
 * GC Monitor implementation
 */
class GCMonitorImpl implements GCMonitor {
  private events: GCEvent[] = [];
  private monitoring = false;

  start(): void {
    if (this.monitoring) {
      return;
    }

    this.monitoring = true;
    this.events = [];

    // Note: Performance observer for GC would be set up here
    // This is a simplified version
  }

  stop(): void {
    this.monitoring = false;
  }

  getEvents(): GCEvent[] {
    return [...this.events];
  }

  getStats(): GCMonitorStats {
    if (this.events.length === 0) {
      return {
        totalEvents: 0,
        totalTime: 0,
        averageDuration: 0,
        maxDuration: 0,
        heapFreed: 0,
      };
    }

    const totalTime = this.events.reduce((sum, e) => sum + e.duration, 0);
    const totalFreed = this.events.reduce((sum, e) => sum + e.freed, 0);
    const maxDuration = Math.max(...this.events.map(e => e.duration));

    return {
      totalEvents: this.events.length,
      totalTime,
      averageDuration: totalTime / this.events.length,
      maxDuration,
      heapFreed: totalFreed,
    };
  }
}

/**
 * Create a memory profiler with default configuration
 */
export function createMemoryProfiler(
  config?: Partial<MemoryProfilerConfig>
): MemoryProfiler {
  return new MemoryProfiler(config);
}
