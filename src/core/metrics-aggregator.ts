/**
 * Metrics Aggregator - Lock-free metrics aggregation across workers
 * Phase 8: Monitoring & Observability
 * 
 * Features:
 * - SharedArrayBuffer for cross-worker metrics
 * - Atomic operations for counter updates
 * - Lock-free histogram for latency percentiles
 * - Sliding window for time-based metrics
 * - Snapshot API for current state
 * 
 * Performance target: < 0.05ms overhead per metric update
 */

import { logger } from '../utils/logger.js';

/**
 * Metrics buffer layout (in 32-bit integers)
 * Index 0-9: Counters (requests, errors, etc.)
 * Index 10-109: Latency histogram buckets (100 buckets)
 * Index 110-209: Request size histogram buckets (100 buckets)
 * Index 210-309: Response size histogram buckets (100 buckets)
 */
const BUFFER_SIZE = 310;
const HISTOGRAM_BUCKETS = 100;

/**
 * Counter indices
 */
enum CounterIndex {
  TOTAL_REQUESTS = 0,
  TOTAL_ERRORS = 1,
  ACTIVE_CONNECTIONS = 2,
  TOTAL_BYTES_SENT = 3,
  TOTAL_BYTES_RECEIVED = 4,
  RESERVED_1 = 5,
  RESERVED_2 = 6,
  RESERVED_3 = 7,
  RESERVED_4 = 8,
  RESERVED_5 = 9,
}

/**
 * Histogram indices
 */
const LATENCY_HISTOGRAM_START = 10;
const REQUEST_SIZE_HISTOGRAM_START = 110;
const RESPONSE_SIZE_HISTOGRAM_START = 210;

/**
 * Metrics snapshot
 */
export interface MetricsSnapshot {
  /** Total requests processed */
  totalRequests: number;
  /** Total errors */
  totalErrors: number;
  /** Active connections */
  activeConnections: number;
  /** Total bytes sent */
  totalBytesSent: number;
  /** Total bytes received */
  totalBytesReceived: number;
  /** Latency percentiles */
  latency: {
    p50: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
    avg: number;
  };
  /** Request size percentiles */
  requestSize: {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
  };
  /** Response size percentiles */
  responseSize: {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
  };
  /** Timestamp of snapshot */
  timestamp: number;
}

/**
 * Sliding window entry
 */
interface WindowEntry {
  timestamp: number;
  value: number;
}

/**
 * Metrics Aggregator
 */
export class MetricsAggregator {
  private buffer: Int32Array;
  private sharedBuffer: SharedArrayBuffer | null = null;
  private useSharedMemory: boolean;
  
  // Sliding windows for time-based metrics
  private latencyWindow: WindowEntry[] = [];
  private requestSizeWindow: WindowEntry[] = [];
  private responseSizeWindow: WindowEntry[] = [];
  
  // Window configuration
  private windowSize = 10000; // Keep last 10k entries
  private windowDuration = 60000; // 1 minute in ms

  constructor(options?: { useSharedMemory?: boolean; windowSize?: number; windowDuration?: number }) {
    this.useSharedMemory = options?.useSharedMemory ?? false;
    this.windowSize = options?.windowSize ?? 10000;
    this.windowDuration = options?.windowDuration ?? 60000;

    if (this.useSharedMemory && typeof SharedArrayBuffer !== 'undefined') {
      try {
        this.sharedBuffer = new SharedArrayBuffer(BUFFER_SIZE * Int32Array.BYTES_PER_ELEMENT);
        this.buffer = new Int32Array(this.sharedBuffer);
        logger.info('Metrics aggregator initialized with SharedArrayBuffer');
      } catch (error) {
        logger.warn(
          `Failed to create SharedArrayBuffer: ${error}. Falling back to regular buffer.`
        );
        this.buffer = new Int32Array(BUFFER_SIZE);
        this.useSharedMemory = false;
      }
    } else {
      this.buffer = new Int32Array(BUFFER_SIZE);
      this.useSharedMemory = false;
    }
  }

  /**
   * Record request with latency
   */
  recordRequest(latency: number, error: boolean = false): void {
    // Atomic increment of request counter
    Atomics.add(this.buffer, CounterIndex.TOTAL_REQUESTS, 1);
    
    if (error) {
      Atomics.add(this.buffer, CounterIndex.TOTAL_ERRORS, 1);
    }

    // Add to latency histogram
    this.addToHistogram(LATENCY_HISTOGRAM_START, latency, 1, 100); // 1ms-100ms range
    
    // Add to sliding window
    this.addToWindow(this.latencyWindow, latency);
  }

  /**
   * Record request size
   */
  recordRequestSize(size: number): void {
    this.addToHistogram(REQUEST_SIZE_HISTOGRAM_START, size, 100, 10000); // 100B-10KB range
    this.addToWindow(this.requestSizeWindow, size);
  }

  /**
   * Record response size
   */
  recordResponseSize(size: number): void {
    this.addToHistogram(RESPONSE_SIZE_HISTOGRAM_START, size, 100, 10000); // 100B-10KB range
    this.addToWindow(this.responseSizeWindow, size);
  }

  /**
   * Record bytes sent/received
   */
  recordBytes(sent: number, received: number): void {
    Atomics.add(this.buffer, CounterIndex.TOTAL_BYTES_SENT, sent);
    Atomics.add(this.buffer, CounterIndex.TOTAL_BYTES_RECEIVED, received);
  }

  /**
   * Update active connections
   */
  updateActiveConnections(delta: number): void {
    Atomics.add(this.buffer, CounterIndex.ACTIVE_CONNECTIONS, delta);
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot(): MetricsSnapshot {
    const now = Date.now();

    // Read counters atomically
    const totalRequests = Atomics.load(this.buffer, CounterIndex.TOTAL_REQUESTS);
    const totalErrors = Atomics.load(this.buffer, CounterIndex.TOTAL_ERRORS);
    const activeConnections = Atomics.load(this.buffer, CounterIndex.ACTIVE_CONNECTIONS);
    const totalBytesSent = Atomics.load(this.buffer, CounterIndex.TOTAL_BYTES_SENT);
    const totalBytesReceived = Atomics.load(this.buffer, CounterIndex.TOTAL_BYTES_RECEIVED);

    // Calculate latency percentiles from histogram
    const latency = this.calculateHistogramPercentiles(
      LATENCY_HISTOGRAM_START,
      1,
      100,
      totalRequests
    );

    // Calculate request size percentiles
    const requestSize = this.calculateHistogramPercentiles(
      REQUEST_SIZE_HISTOGRAM_START,
      100,
      10000,
      totalRequests
    );

    // Calculate response size percentiles
    const responseSize = this.calculateHistogramPercentiles(
      RESPONSE_SIZE_HISTOGRAM_START,
      100,
      10000,
      totalRequests
    );

    return {
      totalRequests,
      totalErrors,
      activeConnections,
      totalBytesSent,
      totalBytesReceived,
      latency,
      requestSize,
      responseSize,
      timestamp: now,
    };
  }

  /**
   * Get sliding window snapshot (more accurate for recent data)
   */
  getWindowSnapshot(): MetricsSnapshot {
    const now = Date.now();
    const cutoff = now - this.windowDuration;

    // Clean old entries
    this.cleanWindow(this.latencyWindow, cutoff);
    this.cleanWindow(this.requestSizeWindow, cutoff);
    this.cleanWindow(this.responseSizeWindow, cutoff);

    // Calculate percentiles from windows
    const latencyPercentiles = this.calculateWindowPercentiles(this.latencyWindow);
    const requestSizePercentiles = this.calculateWindowPercentiles(this.requestSizeWindow);
    const responseSizePercentiles = this.calculateWindowPercentiles(this.responseSizeWindow);

    // Calculate min/max from window
    const latencyValues = this.latencyWindow.map(e => e.value);
    const latency = {
      ...latencyPercentiles,
      min: latencyValues.length > 0 ? Math.min(...latencyValues) : 0,
      max: latencyValues.length > 0 ? Math.max(...latencyValues) : 0,
    };

    const requestSize = requestSizePercentiles;
    const responseSize = responseSizePercentiles;

    // Read counters
    const totalRequests = Atomics.load(this.buffer, CounterIndex.TOTAL_REQUESTS);
    const totalErrors = Atomics.load(this.buffer, CounterIndex.TOTAL_ERRORS);
    const activeConnections = Atomics.load(this.buffer, CounterIndex.ACTIVE_CONNECTIONS);
    const totalBytesSent = Atomics.load(this.buffer, CounterIndex.TOTAL_BYTES_SENT);
    const totalBytesReceived = Atomics.load(this.buffer, CounterIndex.TOTAL_BYTES_RECEIVED);

    return {
      totalRequests,
      totalErrors,
      activeConnections,
      totalBytesSent,
      totalBytesReceived,
      latency,
      requestSize,
      responseSize,
      timestamp: now,
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    // Reset all counters atomically
    for (let i = 0; i < BUFFER_SIZE; i++) {
      Atomics.store(this.buffer, i, 0);
    }

    // Clear windows
    this.latencyWindow = [];
    this.requestSizeWindow = [];
    this.responseSizeWindow = [];

    logger.info('Metrics aggregator reset');
  }

  /**
   * Get shared buffer (for sharing across workers)
   */
  getSharedBuffer(): SharedArrayBuffer | null {
    return this.sharedBuffer;
  }

  /**
   * Add value to histogram bucket
   */
  private addToHistogram(
    startIndex: number,
    value: number,
    minValue: number,
    maxValue: number
  ): void {
    // Clamp value to range
    const clampedValue = Math.max(minValue, Math.min(maxValue, value));
    
    // Calculate bucket index (logarithmic distribution)
    const normalized = (clampedValue - minValue) / (maxValue - minValue);
    const bucketIndex = Math.floor(Math.log(1 + normalized * (Math.E - 1)) * HISTOGRAM_BUCKETS);
    const finalIndex = Math.min(startIndex + bucketIndex, startIndex + HISTOGRAM_BUCKETS - 1);

    // Atomic increment of bucket
    Atomics.add(this.buffer, finalIndex, 1);
  }

  /**
   * Calculate percentiles from histogram
   */
  private calculateHistogramPercentiles(
    startIndex: number,
    minValue: number,
    maxValue: number,
    totalCount: number
  ): { p50: number; p95: number; p99: number; min: number; max: number; avg: number } {
    if (totalCount === 0) {
      return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
    }

    // Read histogram buckets
    const buckets: number[] = [];
    let sum = 0;
    let count = 0;
    let min = maxValue;
    let max = minValue;

    for (let i = 0; i < HISTOGRAM_BUCKETS; i++) {
      const bucketCount = Atomics.load(this.buffer, startIndex + i);
      buckets.push(bucketCount);
      
      if (bucketCount > 0) {
        // Calculate bucket value (inverse of logarithmic distribution)
        const bucketValue =
          minValue +
          (maxValue - minValue) * (Math.exp(i / HISTOGRAM_BUCKETS) - 1) / (Math.E - 1);
        
        sum += bucketValue * bucketCount;
        count += bucketCount;
        min = Math.min(min, bucketValue);
        max = Math.max(max, bucketValue);
      }
    }

    const avg = count > 0 ? sum / count : 0;

    // Calculate percentiles
    const p50 = this.findPercentile(buckets, 0.5, minValue, maxValue);
    const p95 = this.findPercentile(buckets, 0.95, minValue, maxValue);
    const p99 = this.findPercentile(buckets, 0.99, minValue, maxValue);

    return { p50, p95, p99, min, max, avg };
  }

  /**
   * Find percentile value from histogram buckets
   */
  private findPercentile(
    buckets: number[],
    percentile: number,
    minValue: number,
    maxValue: number
  ): number {
    const totalCount = buckets.reduce((sum, count) => sum + count, 0);
    if (totalCount === 0) return 0;

    const targetCount = Math.ceil(totalCount * percentile);
    let accumulatedCount = 0;

    for (let i = 0; i < buckets.length; i++) {
      const bucketCount = buckets[i];
      if (bucketCount === undefined) continue;
      
      accumulatedCount += bucketCount;
      if (accumulatedCount >= targetCount) {
        // Calculate value for this bucket (inverse of logarithmic distribution)
        return (
          minValue +
          (maxValue - minValue) * (Math.exp(i / HISTOGRAM_BUCKETS) - 1) / (Math.E - 1)
        );
      }
    }

    return maxValue;
  }

  /**
   * Add value to sliding window
   */
  private addToWindow(window: WindowEntry[], value: number): void {
    window.push({
      timestamp: Date.now(),
      value,
    });

    // Trim window if too large
    if (window.length > this.windowSize) {
      window.shift();
    }
  }

  /**
   * Clean old entries from window
   */
  private cleanWindow(window: WindowEntry[], cutoff: number): void {
    let firstValidIndex = 0;
    for (let i = 0; i < window.length; i++) {
      const entry = window[i];
      if (entry && entry.timestamp >= cutoff) {
        firstValidIndex = i;
        break;
      }
    }
    
    if (firstValidIndex > 0) {
      window.splice(0, firstValidIndex);
    }
  }

  /**
   * Calculate percentiles from sliding window
   */
  private calculateWindowPercentiles(
    window: WindowEntry[]
  ): { p50: number; p95: number; p99: number; avg: number } {
    if (window.length === 0) {
      return { p50: 0, p95: 0, p99: 0, avg: 0 };
    }

    // Sort values
    const values = window.map((entry) => entry.value).sort((a, b) => a - b);

    // Calculate percentiles
    const p50Index = Math.floor(values.length * 0.5);
    const p95Index = Math.floor(values.length * 0.95);
    const p99Index = Math.floor(values.length * 0.99);

    const p50 = values[p50Index] || 0;
    const p95 = values[p95Index] || 0;
    const p99 = values[p99Index] || 0;

    // Calculate average
    const sum = values.reduce((acc, val) => acc + val, 0);
    const avg = sum / values.length;

    return { p50, p95, p99, avg };
  }

  /**
   * Get statistics about the aggregator
   */
  getStats(): {
    useSharedMemory: boolean;
    bufferSize: number;
    windowSize: number;
    windowDuration: number;
    latencyWindowEntries: number;
    requestSizeWindowEntries: number;
    responseSizeWindowEntries: number;
  } {
    return {
      useSharedMemory: this.useSharedMemory,
      bufferSize: BUFFER_SIZE,
      windowSize: this.windowSize,
      windowDuration: this.windowDuration,
      latencyWindowEntries: this.latencyWindow.length,
      requestSizeWindowEntries: this.requestSizeWindow.length,
      responseSizeWindowEntries: this.responseSizeWindow.length,
    };
  }
}
