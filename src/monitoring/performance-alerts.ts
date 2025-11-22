/**
 * Performance alerting system
 * Phase 9: Intelligent performance monitoring and alerting
 */

/**
 * Alert severity levels
 */
export type AlertSeverity = 'info' | 'warning' | 'critical';

/**
 * Metrics for alert evaluation
 */
export interface Metrics {
  latencyP99: number;
  latencyP95: number;
  latencyP50: number;
  rps: number;
  errorRate: number;
  memoryGrowthRate: number; // MB/hour
  gcPauseP99: number;
  circuitBreakerOpen: boolean;
  connectionPoolUtilization: number;
}

/**
 * Alert rule definition
 */
export interface AlertRule {
  name: string;
  condition: (metrics: Metrics) => boolean;
  severity: AlertSeverity;
  cooldown: number; // ms between alerts
}

/**
 * Active alert
 */
export interface Alert {
  id: string;
  ruleName: string;
  severity: AlertSeverity;
  message: string;
  timestamp: number;
  metrics: Partial<Metrics>;
}

/**
 * Alert configuration
 */
export interface AlertConfig {
  enabled: boolean;
  rules?: AlertRule[];
  defaultCooldown?: number;
  notificationHandler?: (alert: Alert) => Promise<void>;
}

/**
 * Performance Alerter
 */
export class PerformanceAlerter {
  private config: AlertConfig;
  private rules: AlertRule[] = [];
  private lastAlertTime: Map<string, number> = new Map();
  private activeAlerts: Alert[] = [];

  constructor(config: AlertConfig) {
    this.config = {
      enabled: config.enabled ?? true,
      defaultCooldown: config.defaultCooldown || 60000, // 1 minute default
      notificationHandler: config.notificationHandler,
    };

    if (config.rules) {
      this.rules = [...config.rules];
    }

    // Add built-in rules
    this.addBuiltInRules();
  }

  /**
   * Add alert rule
   */
  addRule(rule: AlertRule): void {
    this.rules.push(rule);
  }

  /**
   * Check for alerts based on current metrics
   */
  checkAlerts(metrics: Metrics): Alert[] {
    if (!this.config.enabled) {
      return [];
    }

    const alerts: Alert[] = [];
    const now = Date.now();

    for (const rule of this.rules) {
      try {
        // Check cooldown
        const lastAlert = this.lastAlertTime.get(rule.name) || 0;
        if (now - lastAlert < rule.cooldown) {
          continue;
        }

        // Evaluate condition
        if (rule.condition(metrics)) {
          const alert: Alert = {
            id: `${rule.name}-${now}`,
            ruleName: rule.name,
            severity: rule.severity,
            message: this.generateMessage(rule, metrics),
            timestamp: now,
            metrics,
          };

          alerts.push(alert);
          this.activeAlerts.push(alert);
          this.lastAlertTime.set(rule.name, now);

          // Send notification
          this.sendAlert(alert).catch(console.error);
        }
      } catch (error) {
        console.error(`Error evaluating rule ${rule.name}:`, error);
      }
    }

    // Cleanup old alerts
    this.activeAlerts = this.activeAlerts.filter(
      (a) => now - a.timestamp < 3600000 // Keep last hour
    );

    return alerts;
  }

  /**
   * Send alert notification
   */
  async sendAlert(alert: Alert): Promise<void> {
    if (this.config.notificationHandler) {
      await this.config.notificationHandler(alert);
    } else {
      // Default: log to console
      console.warn(`[${alert.severity.toUpperCase()}] ${alert.message}`);
    }
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return [...this.activeAlerts];
  }

  /**
   * Clear all alerts
   */
  clearAlerts(): void {
    this.activeAlerts = [];
    this.lastAlertTime.clear();
  }

  /**
   * Generate alert message
   */
  private generateMessage(rule: AlertRule, metrics: Metrics): string {
    switch (rule.name) {
      case 'latency-threshold':
        return `P99 latency exceeded threshold: ${metrics.latencyP99.toFixed(2)}ms`;
      case 'rps-drop':
        return `RPS dropped significantly: ${metrics.rps.toFixed(0)} req/s`;
      case 'memory-leak':
        return `Memory leak detected: growing at ${metrics.memoryGrowthRate.toFixed(2)} MB/hour`;
      case 'gc-pause':
        return `GC pause exceeded threshold: ${metrics.gcPauseP99.toFixed(2)}ms`;
      case 'error-rate-spike':
        return `Error rate spiked: ${(metrics.errorRate * 100).toFixed(2)}%`;
      case 'circuit-breaker-open':
        return `Circuit breaker opened for upstream`;
      case 'connection-pool-exhaustion':
        return `Connection pool utilization high: ${(metrics.connectionPoolUtilization * 100).toFixed(0)}%`;
      default:
        return `Alert triggered: ${rule.name}`;
    }
  }

  /**
   * Add built-in alert rules
   */
  private addBuiltInRules(): void {
    // Latency threshold (P99 > 10ms)
    this.rules.push({
      name: 'latency-threshold',
      condition: (m) => m.latencyP99 > 10,
      severity: 'critical',
      cooldown: this.config.defaultCooldown || 60000,
    });

    // RPS drop (> 20% decrease)
    let lastRPS = 0;
    this.rules.push({
      name: 'rps-drop',
      condition: (m) => {
        if (lastRPS === 0) {
          lastRPS = m.rps;
          return false;
        }
        const drop = (lastRPS - m.rps) / lastRPS;
        const alert = drop > 0.2;
        lastRPS = m.rps;
        return alert;
      },
      severity: 'warning',
      cooldown: this.config.defaultCooldown || 60000,
    });

    // Memory leak (> 10MB/hour growth)
    this.rules.push({
      name: 'memory-leak',
      condition: (m) => m.memoryGrowthRate > 10,
      severity: 'warning',
      cooldown: 300000, // 5 minutes
    });

    // GC pause (> 100ms)
    this.rules.push({
      name: 'gc-pause',
      condition: (m) => m.gcPauseP99 > 100,
      severity: 'warning',
      cooldown: this.config.defaultCooldown || 60000,
    });

    // Error rate spike (> 5%)
    this.rules.push({
      name: 'error-rate-spike',
      condition: (m) => m.errorRate > 0.05,
      severity: 'critical',
      cooldown: this.config.defaultCooldown || 60000,
    });

    // Circuit breaker opening
    this.rules.push({
      name: 'circuit-breaker-open',
      condition: (m) => m.circuitBreakerOpen,
      severity: 'warning',
      cooldown: 120000, // 2 minutes
    });

    // Connection pool exhaustion (> 90% utilization)
    this.rules.push({
      name: 'connection-pool-exhaustion',
      condition: (m) => m.connectionPoolUtilization > 0.9,
      severity: 'warning',
      cooldown: this.config.defaultCooldown || 60000,
    });
  }

  /**
   * Get configured rules
   */
  getRules(): AlertRule[] {
    return [...this.rules];
  }

  /**
   * Enable alerting
   */
  enable(): void {
    this.config.enabled = true;
  }

  /**
   * Disable alerting
   */
  disable(): void {
    this.config.enabled = false;
  }

  /**
   * Check if alerting is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled ?? true;
  }
}
