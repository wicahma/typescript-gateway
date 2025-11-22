/**
 * Timeout Manager for Phase 7: Resilience & Error Handling
 * 
 * Implements hierarchical timeout management with proper resource cleanup
 * Performance target: < 0.01ms overhead for timeout checks
 */

import { TimeoutError } from './errors.js';
import { logger } from '../utils/logger.js';

/**
 * Timeout configuration
 */
export interface TimeoutConfig {
  /** Connection timeout in milliseconds */
  connection: number;
  /** Total request timeout in milliseconds (including retries) */
  request: number;
  /** Upstream response timeout in milliseconds */
  upstream: number;
  /** Per-plugin execution timeout in milliseconds */
  plugin: number;
  /** Idle connection timeout in milliseconds */
  idle: number;
}

/**
 * Default timeout configuration
 */
const DEFAULT_CONFIG: TimeoutConfig = {
  connection: 5000,
  request: 30000,
  upstream: 20000,
  plugin: 1000,
  idle: 60000,
};

/**
 * Timeout handle
 */
export interface TimeoutHandle {
  /** Timeout ID */
  id: NodeJS.Timeout;
  /** Timeout type */
  type: keyof TimeoutConfig;
  /** Start time */
  startTime: number;
  /** Timeout duration in milliseconds */
  duration: number;
  /** Whether timeout was triggered */
  triggered: boolean;
  /** AbortController for cancellation */
  controller?: AbortController;
}

/**
 * Timeout context
 */
export interface TimeoutContext {
  /** Request ID for tracking */
  requestId?: string;
  /** Operation description */
  operation?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Timeout Manager
 */
export class TimeoutManager {
  private config: TimeoutConfig;
  private activeTimeouts: Map<string, TimeoutHandle> = new Map();
  private timeoutCount = 0;
  private timeoutsByType: Map<keyof TimeoutConfig, number> = new Map();

  constructor(config?: Partial<TimeoutConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeStats();
  }

  /**
   * Initialize statistics
   */
  private initializeStats(): void {
    const types: Array<keyof TimeoutConfig> = [
      'connection',
      'request',
      'upstream',
      'plugin',
      'idle',
    ];
    for (const type of types) {
      this.timeoutsByType.set(type, 0);
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TimeoutConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get timeout duration for type
   */
  getTimeout(type: keyof TimeoutConfig): number {
    return this.config[type];
  }

  /**
   * Execute function with timeout
   */
  async execute<T>(
    fn: () => Promise<T>,
    type: keyof TimeoutConfig,
    context?: TimeoutContext,
    customTimeout?: number
  ): Promise<T> {
    const timeout = customTimeout || this.config[type];
    const controller = new AbortController();
    const handleId = this.generateHandleId();

    return new Promise<T>((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        const handle = this.activeTimeouts.get(handleId);
        if (handle) {
          handle.triggered = true;
          controller.abort();
          // Delete from active timeouts
          this.activeTimeouts.delete(handleId);
        }

        // Increment timeout counter
        this.timeoutCount++;
        const typeCount = this.timeoutsByType.get(type) || 0;
        this.timeoutsByType.set(type, typeCount + 1);

        // Map type to timeout error type
        const timeoutTypeMap: Record<keyof TimeoutConfig, 'connection' | 'request' | 'upstream' | 'plugin'> = {
          connection: 'connection',
          request: 'request',
          upstream: 'upstream',
          plugin: 'plugin',
          idle: 'connection', // idle timeouts map to connection type
        };
        const timeoutType = timeoutTypeMap[type];

        const error = new TimeoutError(
          `Operation timed out after ${timeout}ms`,
          timeoutType,
          timeout,
          `${type.toUpperCase()}_TIMEOUT`,
          504,
          type !== 'plugin', // Don't retry plugin timeouts
          {
            requestContext: context?.requestId
              ? {
                  requestId: context.requestId,
                }
              : undefined,
            metadata: context?.metadata,
          }
        );

        logger.debug(
          `Timeout triggered for ${type}: ${context?.operation || 'unknown'} after ${timeout}ms`
        );

        reject(error);
      }, timeout);

      // Store timeout handle
      const handle: TimeoutHandle = {
        id: timeoutId,
        type,
        startTime: Date.now(),
        duration: timeout,
        triggered: false,
        controller,
      };
      this.activeTimeouts.set(handleId, handle);

      // Execute function
      fn()
        .then((result) => {
          // Clear timeout if not triggered
          const handle = this.activeTimeouts.get(handleId);
          if (handle && !handle.triggered) {
            clearTimeout(handle.id);
            this.activeTimeouts.delete(handleId);
            resolve(result);
          }
        })
        .catch((error) => {
          // Clear timeout
          const handle = this.activeTimeouts.get(handleId);
          if (handle && !handle.triggered) {
            clearTimeout(handle.id);
            this.activeTimeouts.delete(handleId);
            reject(error);
          }
        });
    });
  }

  /**
   * Create timeout handle with AbortController
   */
  createHandle(
    type: keyof TimeoutConfig,
    context?: TimeoutContext,
    customTimeout?: number
  ): { handleId: string; signal: AbortSignal; cancel: () => void } {
    const timeout = customTimeout || this.config[type];
    const controller = new AbortController();
    const handleId = this.generateHandleId();

    const timeoutId = setTimeout(() => {
      const handle = this.activeTimeouts.get(handleId);
      if (handle) {
        handle.triggered = true;
        controller.abort();

        // Increment timeout counter
        this.timeoutCount++;
        const typeCount = this.timeoutsByType.get(type) || 0;
        this.timeoutsByType.set(type, typeCount + 1);

        logger.debug(
          `Timeout triggered for ${type}: ${context?.operation || 'unknown'} after ${timeout}ms`
        );
      }
    }, timeout);

    const handle: TimeoutHandle = {
      id: timeoutId,
      type,
      startTime: Date.now(),
      duration: timeout,
      triggered: false,
      controller,
    };
    this.activeTimeouts.set(handleId, handle);

    const cancel = () => {
      const handle = this.activeTimeouts.get(handleId);
      if (handle && !handle.triggered) {
        clearTimeout(handle.id);
        this.activeTimeouts.delete(handleId);
      }
    };

    return {
      handleId,
      signal: controller.signal,
      cancel,
    };
  }

  /**
   * Cancel timeout by handle ID
   */
  cancel(handleId: string): void {
    const handle = this.activeTimeouts.get(handleId);
    if (handle && !handle.triggered) {
      clearTimeout(handle.id);
      this.activeTimeouts.delete(handleId);
    }
  }

  /**
   * Cancel all active timeouts
   */
  cancelAll(): void {
    for (const [handleId, handle] of this.activeTimeouts.entries()) {
      if (!handle.triggered) {
        clearTimeout(handle.id);
        this.activeTimeouts.delete(handleId);
      }
    }
  }

  /**
   * Get active timeout count
   */
  getActiveCount(): number {
    return this.activeTimeouts.size;
  }

  /**
   * Get timeout statistics
   */
  getStats(): {
    totalTimeouts: number;
    activeTimeouts: number;
    timeoutsByType: Record<keyof TimeoutConfig, number>;
  } {
    const timeoutsByType: Record<keyof TimeoutConfig, number> = {
      connection: this.timeoutsByType.get('connection') || 0,
      request: this.timeoutsByType.get('request') || 0,
      upstream: this.timeoutsByType.get('upstream') || 0,
      plugin: this.timeoutsByType.get('plugin') || 0,
      idle: this.timeoutsByType.get('idle') || 0,
    };

    return {
      totalTimeouts: this.timeoutCount,
      activeTimeouts: this.activeTimeouts.size,
      timeoutsByType,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.timeoutCount = 0;
    this.initializeStats();
  }

  /**
   * Check if handle timed out
   */
  hasTimedOut(handleId: string): boolean {
    const handle = this.activeTimeouts.get(handleId);
    return handle ? handle.triggered : false;
  }

  /**
   * Get elapsed time for handle
   */
  getElapsed(handleId: string): number {
    const handle = this.activeTimeouts.get(handleId);
    return handle ? Date.now() - handle.startTime : 0;
  }

  /**
   * Generate unique handle ID
   */
  private generateHandleId(): string {
    return `timeout-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Cleanup all resources
   */
  destroy(): void {
    this.cancelAll();
    this.activeTimeouts.clear();
    logger.info('Timeout manager destroyed');
  }
}
