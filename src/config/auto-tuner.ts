/**
 * Auto-tuning system for performance optimization
 * Phase 9: Automatic configuration optimization based on load patterns
 */

/**
 * Configuration optimization recommendation
 */
export interface ConfigOptimization {
  parameter: string;
  currentValue: number;
  recommendedValue: number;
  reason: string;
  impact: 'low' | 'medium' | 'high';
  confidence: number; // 0-1
}

/**
 * Load pattern analysis
 */
export interface LoadPattern {
  avgRPS: number;
  peakRPS: number;
  avgLatency: number;
  p99Latency: number;
  errorRate: number;
  memoryUsage: number;
  cpuUsage: number;
  activeConnections: number;
}

/**
 * Auto-tuner configuration
 */
export interface AutoTunerConfig {
  enabled: boolean;
  observationWindow: number; // ms
  minObservations: number;
  safeMode: boolean; // Only recommend, don't auto-apply
  aggressiveness: 'conservative' | 'moderate' | 'aggressive';
}

/**
 * Tunable parameter definition
 */
interface TunableParameter {
  name: string;
  min: number;
  max: number;
  step: number;
  current: number;
}

/**
 * Auto-Tuner class
 */
export class AutoTuner {
  private config: AutoTunerConfig;
  private tuning = false;
  private loadHistory: LoadPattern[] = [];
  private parameters: Map<string, TunableParameter> = new Map();
  private optimizations: ConfigOptimization[] = [];
  private tuningInterval: NodeJS.Timeout | null = null;

  constructor(config: AutoTunerConfig) {
    this.config = {
      enabled: config.enabled ?? true,
      observationWindow: config.observationWindow || 300000, // 5 minutes
      minObservations: config.minObservations || 10,
      safeMode: config.safeMode ?? true,
      aggressiveness: config.aggressiveness || 'moderate',
    };

    this.initializeParameters();
  }

  /**
   * Initialize tunable parameters with defaults
   */
  private initializeParameters(): void {
    this.parameters.set('connectionPoolSize', {
      name: 'connectionPoolSize',
      min: 10,
      max: 500,
      step: 10,
      current: 100,
    });

    this.parameters.set('workerCount', {
      name: 'workerCount',
      min: 1,
      max: 32,
      step: 1,
      current: 4,
    });

    this.parameters.set('bufferSize', {
      name: 'bufferSize',
      min: 1024,
      max: 65536,
      step: 1024,
      current: 16384,
    });

    this.parameters.set('timeoutMs', {
      name: 'timeoutMs',
      min: 1000,
      max: 60000,
      step: 1000,
      current: 30000,
    });

    this.parameters.set('cacheSize', {
      name: 'cacheSize',
      min: 100,
      max: 10000,
      step: 100,
      current: 1000,
    });
  }

  /**
   * Start auto-tuning based on load patterns
   */
  startTuning(): void {
    if (this.tuning) {
      return;
    }

    this.tuning = true;
    this.loadHistory = [];

    this.tuningInterval = setInterval(() => {
      this.analyzeAndOptimize();
    }, this.config.observationWindow);

    console.log('Auto-tuner started');
  }

  /**
   * Stop auto-tuning
   */
  stopTuning(): void {
    if (this.tuningInterval) {
      clearInterval(this.tuningInterval);
      this.tuningInterval = null;
    }

    this.tuning = false;
    console.log('Auto-tuner stopped');
  }

  /**
   * Record load pattern observation
   */
  recordLoadPattern(pattern: LoadPattern): void {
    this.loadHistory.push(pattern);

    // Keep history within observation window
    this.loadHistory = this.loadHistory.filter(
      (_p, index) => index >= this.loadHistory.length - 100 // Keep last 100 observations
    );
  }

  /**
   * Analyze load patterns and generate optimizations
   */
  private analyzeAndOptimize(): void {
    if (this.loadHistory.length < this.config.minObservations) {
      return;
    }

    this.optimizations = [];

    // Analyze each parameter
    this.analyzeConnectionPool();
    this.analyzeWorkerCount();
    this.analyzeBufferSize();
    this.analyzeTimeouts();
    this.analyzeCacheSize();

    // Auto-apply if not in safe mode
    if (!this.config.safeMode && this.optimizations.length > 0) {
      this.applyOptimizations(this.optimizations).catch(console.error);
    }
  }

  /**
   * Analyze connection pool size
   */
  private analyzeConnectionPool(): void {
    const param = this.parameters.get('connectionPoolSize');
    if (!param) return;

    const avgConnections = this.calculateAverage('activeConnections');
    const peakConnections = Math.max(
      ...this.loadHistory.map((p) => p.activeConnections)
    );

    // If consistently using > 80% of pool, increase
    if (peakConnections > param.current * 0.8) {
      const recommended = Math.min(
        param.max,
        Math.ceil(peakConnections * 1.2 / param.step) * param.step
      );

      if (recommended > param.current) {
        this.optimizations.push({
          parameter: 'connectionPoolSize',
          currentValue: param.current,
          recommendedValue: recommended,
          reason: `Peak usage (${peakConnections}) approaching limit`,
          impact: 'high',
          confidence: 0.85,
        });
      }
    }

    // If consistently using < 30% of pool, decrease
    if (avgConnections < param.current * 0.3) {
      const recommended = Math.max(
        param.min,
        Math.ceil(avgConnections * 2 / param.step) * param.step
      );

      if (recommended < param.current) {
        this.optimizations.push({
          parameter: 'connectionPoolSize',
          currentValue: param.current,
          recommendedValue: recommended,
          reason: 'Pool underutilized, reduce to save resources',
          impact: 'medium',
          confidence: 0.75,
        });
      }
    }
  }

  /**
   * Analyze worker count
   */
  private analyzeWorkerCount(): void {
    const param = this.parameters.get('workerCount');
    if (!param) return;

    const avgCPU = this.calculateAverage('cpuUsage');
    const p99Latency = this.calculateAverage('p99Latency');

    // If high CPU and high latency, consider more workers
    if (avgCPU > 0.8 && p99Latency > 10) {
      const recommended = Math.min(param.max, param.current + param.step);

      if (recommended > param.current) {
        this.optimizations.push({
          parameter: 'workerCount',
          currentValue: param.current,
          recommendedValue: recommended,
          reason: 'High CPU and latency suggest more workers needed',
          impact: 'high',
          confidence: 0.8,
        });
      }
    }

    // If low CPU utilization, consider fewer workers
    if (avgCPU < 0.3 && param.current > param.min) {
      const recommended = Math.max(param.min, param.current - param.step);

      this.optimizations.push({
        parameter: 'workerCount',
        currentValue: param.current,
        recommendedValue: recommended,
        reason: 'Low CPU utilization, reduce worker count',
        impact: 'low',
        confidence: 0.7,
      });
    }
  }

  /**
   * Analyze buffer size
   */
  private analyzeBufferSize(): void {
    const param = this.parameters.get('bufferSize');
    if (!param) return;

    const avgRPS = this.calculateAverage('avgRPS');

    // Higher RPS benefits from larger buffers
    if (avgRPS > 50000 && param.current < param.max) {
      const recommended = Math.min(param.max, param.current + param.step);

      this.optimizations.push({
        parameter: 'bufferSize',
        currentValue: param.current,
        recommendedValue: recommended,
        reason: 'High RPS benefits from larger buffers',
        impact: 'medium',
        confidence: 0.75,
      });
    }
  }

  /**
   * Analyze timeout values
   */
  private analyzeTimeouts(): void {
    const param = this.parameters.get('timeoutMs');
    if (!param) return;

    const p99Latency = this.calculateAverage('p99Latency');

    // Timeout should be significantly higher than P99 latency
    const idealTimeout = p99Latency * 3;

    if (idealTimeout < param.current * 0.5) {
      // Timeout too high
      const recommended = Math.max(
        param.min,
        Math.ceil(idealTimeout / param.step) * param.step
      );

      if (recommended < param.current) {
        this.optimizations.push({
          parameter: 'timeoutMs',
          currentValue: param.current,
          recommendedValue: recommended,
          reason: 'Timeout can be reduced based on observed latencies',
          impact: 'low',
          confidence: 0.7,
        });
      }
    } else if (idealTimeout > param.current * 1.5) {
      // Timeout too low
      const recommended = Math.min(
        param.max,
        Math.ceil(idealTimeout / param.step) * param.step
      );

      if (recommended > param.current) {
        this.optimizations.push({
          parameter: 'timeoutMs',
          currentValue: param.current,
          recommendedValue: recommended,
          reason: 'Timeout should be increased to avoid premature failures',
          impact: 'medium',
          confidence: 0.75,
        });
      }
    }
  }

  /**
   * Analyze cache size
   */
  private analyzeCacheSize(): void {
    const param = this.parameters.get('cacheSize');
    if (!param) return;

    // This would analyze cache hit rates in a real implementation
    // For now, base it on RPS
    const avgRPS = this.calculateAverage('avgRPS');

    if (avgRPS > 100000 && param.current < param.max) {
      const recommended = Math.min(param.max, param.current + param.step * 5);

      this.optimizations.push({
        parameter: 'cacheSize',
        currentValue: param.current,
        recommendedValue: recommended,
        reason: 'High RPS benefits from larger cache',
        impact: 'medium',
        confidence: 0.7,
      });
    }
  }

  /**
   * Calculate average of a metric
   */
  private calculateAverage(metric: keyof LoadPattern): number {
    if (this.loadHistory.length === 0) return 0;

    const sum = this.loadHistory.reduce((acc, p) => acc + p[metric], 0);
    return sum / this.loadHistory.length;
  }

  /**
   * Get optimization recommendations
   */
  getRecommendations(): ConfigOptimization[] {
    return [...this.optimizations];
  }

  /**
   * Apply optimizations
   */
  async applyOptimizations(opts: ConfigOptimization[]): Promise<void> {
    for (const opt of opts) {
      const param = this.parameters.get(opt.parameter);
      if (param) {
        console.log(
          `Applying optimization: ${opt.parameter} ${param.current} -> ${opt.recommendedValue}`
        );
        param.current = opt.recommendedValue;

        // In a real implementation, this would update the actual configuration
        // and potentially restart affected components
      }
    }
  }

  /**
   * Get current parameter values
   */
  getParameters(): Map<string, TunableParameter> {
    return new Map(this.parameters);
  }

  /**
   * Update parameter manually
   */
  updateParameter(name: string, value: number): void {
    const param = this.parameters.get(name);
    if (param) {
      param.current = Math.max(param.min, Math.min(param.max, value));
    }
  }

  /**
   * Check if tuning is active
   */
  isTuning(): boolean {
    return this.tuning;
  }
}
