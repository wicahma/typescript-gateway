/**
 * Plugin metrics collection system
 * Tracks plugin execution performance and health
 */

/**
 * Plugin execution metrics
 */
export interface PluginMetrics {
  /** Plugin name */
  name: string;
  /** Total invocations */
  invocations: number;
  /** Total errors */
  errors: number;
  /** Total timeouts */
  timeouts: number;
  /** Success count */
  successes: number;
  /** Average execution time in microseconds */
  avgExecutionTime: number;
  /** Min execution time in microseconds */
  minExecutionTime: number;
  /** Max execution time in microseconds */
  maxExecutionTime: number;
  /** P50 latency in microseconds */
  p50Latency: number;
  /** P95 latency in microseconds */
  p95Latency: number;
  /** P99 latency in microseconds */
  p99Latency: number;
  /** Error rate (0-1) */
  errorRate: number;
  /** Timeout rate (0-1) */
  timeoutRate: number;
  /** Last execution timestamp */
  lastExecution: number;
  /** Last error timestamp */
  lastError: number | null;
  /** Plugin enabled status */
  enabled: boolean;
}

/**
 * Plugin execution record for percentile calculation
 */
interface ExecutionRecord {
  timestamp: number;
  duration: number;
  success: boolean;
}

/**
 * Plugin metrics collector
 * Collects and aggregates plugin execution metrics
 */
export class PluginMetricsCollector {
  private metrics: Map<string, PluginMetrics> = new Map();
  private executionHistory: Map<string, ExecutionRecord[]> = new Map();
  private readonly historyLimit = 1000; // Keep last 1000 executions for percentiles
  
  /**
   * Initialize metrics for a plugin
   */
  initialize(pluginName: string): void {
    if (!this.metrics.has(pluginName)) {
      this.metrics.set(pluginName, {
        name: pluginName,
        invocations: 0,
        errors: 0,
        timeouts: 0,
        successes: 0,
        avgExecutionTime: 0,
        minExecutionTime: Number.MAX_SAFE_INTEGER,
        maxExecutionTime: 0,
        p50Latency: 0,
        p95Latency: 0,
        p99Latency: 0,
        errorRate: 0,
        timeoutRate: 0,
        lastExecution: 0,
        lastError: null,
        enabled: true,
      });
      
      this.executionHistory.set(pluginName, []);
    }
  }
  
  /**
   * Record a plugin execution
   */
  recordExecution(
    pluginName: string,
    durationMicros: number,
    success: boolean,
    isTimeout: boolean = false
  ): void {
    const metrics = this.metrics.get(pluginName);
    if (!metrics) {
      this.initialize(pluginName);
      return this.recordExecution(pluginName, durationMicros, success, isTimeout);
    }
    
    // Update basic counters
    metrics.invocations++;
    if (success) {
      metrics.successes++;
    } else {
      metrics.errors++;
      metrics.lastError = Date.now();
    }
    
    if (isTimeout) {
      metrics.timeouts++;
    }
    
    // Update timing statistics
    metrics.lastExecution = Date.now();
    
    // Update min/max
    if (durationMicros < metrics.minExecutionTime) {
      metrics.minExecutionTime = durationMicros;
    }
    if (durationMicros > metrics.maxExecutionTime) {
      metrics.maxExecutionTime = durationMicros;
    }
    
    // Update average (incremental calculation)
    metrics.avgExecutionTime =
      (metrics.avgExecutionTime * (metrics.invocations - 1) + durationMicros) / metrics.invocations;
    
    // Update error/timeout rates
    metrics.errorRate = metrics.errors / metrics.invocations;
    metrics.timeoutRate = metrics.timeouts / metrics.invocations;
    
    // Add to execution history for percentile calculation
    const history = this.executionHistory.get(pluginName);
    if (history) {
      history.push({
        timestamp: Date.now(),
        duration: durationMicros,
        success,
      });
      
      // Limit history size
      if (history.length > this.historyLimit) {
        history.shift();
      }
      
      // Recalculate percentiles
      this.updatePercentiles(pluginName);
    }
  }
  
  /**
   * Update percentile metrics
   */
  private updatePercentiles(pluginName: string): void {
    const metrics = this.metrics.get(pluginName);
    const history = this.executionHistory.get(pluginName);
    
    if (!metrics || !history || history.length === 0) {
      return;
    }
    
    // Sort durations
    const durations = history.map((r) => r.duration).sort((a, b) => a - b);
    
    // Calculate percentiles
    metrics.p50Latency = this.getPercentile(durations, 0.5);
    metrics.p95Latency = this.getPercentile(durations, 0.95);
    metrics.p99Latency = this.getPercentile(durations, 0.99);
  }
  
  /**
   * Get percentile value from sorted array
   */
  private getPercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) {
      return 0;
    }
    
    const index = Math.ceil(sortedValues.length * percentile) - 1;
    return sortedValues[index] ?? 0;
  }
  
  /**
   * Get metrics for a plugin
   */
  getMetrics(pluginName: string): PluginMetrics | undefined {
    return this.metrics.get(pluginName);
  }
  
  /**
   * Get all plugin metrics
   */
  getAllMetrics(): Map<string, PluginMetrics> {
    return new Map(this.metrics);
  }
  
  /**
   * Get metrics as array
   */
  getMetricsArray(): PluginMetrics[] {
    return Array.from(this.metrics.values());
  }
  
  /**
   * Reset metrics for a plugin
   */
  reset(pluginName: string): void {
    this.metrics.delete(pluginName);
    this.executionHistory.delete(pluginName);
    this.initialize(pluginName);
  }
  
  /**
   * Reset all metrics
   */
  resetAll(): void {
    const pluginNames = Array.from(this.metrics.keys());
    this.metrics.clear();
    this.executionHistory.clear();
    pluginNames.forEach((name) => this.initialize(name));
  }
  
  /**
   * Enable a plugin
   */
  enable(pluginName: string): void {
    const metrics = this.metrics.get(pluginName);
    if (metrics) {
      metrics.enabled = true;
    }
  }
  
  /**
   * Disable a plugin
   */
  disable(pluginName: string): void {
    const metrics = this.metrics.get(pluginName);
    if (metrics) {
      metrics.enabled = false;
    }
  }
  
  /**
   * Get summary statistics across all plugins
   */
  getSummary(): {
    totalPlugins: number;
    enabledPlugins: number;
    totalInvocations: number;
    totalErrors: number;
    totalTimeouts: number;
    averageLatency: number;
    highestErrorRate: { plugin: string; rate: number } | null;
  } {
    const allMetrics = Array.from(this.metrics.values());
    
    if (allMetrics.length === 0) {
      return {
        totalPlugins: 0,
        enabledPlugins: 0,
        totalInvocations: 0,
        totalErrors: 0,
        totalTimeouts: 0,
        averageLatency: 0,
        highestErrorRate: null,
      };
    }
    
    const totalInvocations = allMetrics.reduce((sum, m) => sum + m.invocations, 0);
    const totalErrors = allMetrics.reduce((sum, m) => sum + m.errors, 0);
    const totalTimeouts = allMetrics.reduce((sum, m) => sum + m.timeouts, 0);
    const averageLatency =
      allMetrics.reduce((sum, m) => sum + m.avgExecutionTime * m.invocations, 0) /
      (totalInvocations || 1);
    
    // Find plugin with highest error rate
    let highestErrorRate: { plugin: string; rate: number } | null = null;
    for (const m of allMetrics) {
      if (!highestErrorRate || m.errorRate > highestErrorRate.rate) {
        highestErrorRate = { plugin: m.name, rate: m.errorRate };
      }
    }
    
    return {
      totalPlugins: allMetrics.length,
      enabledPlugins: allMetrics.filter((m) => m.enabled).length,
      totalInvocations,
      totalErrors,
      totalTimeouts,
      averageLatency,
      highestErrorRate,
    };
  }
  
  /**
   * Export metrics as JSON
   */
  toJSON(): Record<string, PluginMetrics> {
    const result: Record<string, PluginMetrics> = {};
    this.metrics.forEach((metrics, name) => {
      result[name] = { ...metrics };
    });
    return result;
  }
}

/**
 * Global plugin metrics collector instance
 */
export const pluginMetricsCollector = new PluginMetricsCollector();
