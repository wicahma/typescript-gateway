/**
 * Circuit breaker pattern implementation for upstream resilience
 * Phase 4: Upstream Integration & Resilience
 * 
 * Performance target: < 0.05ms overhead when closed
 * Fast-fail target: < 0.1ms rejection when open
 */

import { CircuitBreakerConfig, CircuitBreakerState } from '../types/core.js';
import { logger } from '../utils/logger.js';

/**
 * Circuit breaker events
 */
export enum CircuitBreakerEvent {
  STATE_CHANGE = 'state_change',
  REQUEST_SUCCESS = 'request_success',
  REQUEST_FAILURE = 'request_failure',
  REQUEST_REJECTED = 'request_rejected',
  HALF_OPEN_ATTEMPT = 'half_open_attempt',
}

/**
 * Circuit breaker metrics
 */
export interface CircuitBreakerMetrics {
  /** Current state */
  state: CircuitBreakerState;
  /** Total requests */
  totalRequests: number;
  /** Successful requests */
  successfulRequests: number;
  /** Failed requests */
  failedRequests: number;
  /** Rejected requests (when open) */
  rejectedRequests: number;
  /** Success rate percentage */
  successRate: number;
  /** Failure rate percentage */
  failureRate: number;
  /** Number of state changes */
  stateChanges: number;
  /** Last state change timestamp */
  lastStateChange: number;
  /** Time in current state (ms) */
  timeInState: number;
}

/**
 * Sliding window entry
 */
interface WindowEntry {
  success: boolean;
  timestamp: number;
}

/**
 * Default circuit breaker configuration
 */
const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5, // Open circuit after 5 failures
  successThreshold: 2, // Close circuit after 2 successes in half-open
  timeout: 60000, // Try half-open after 60 seconds
  windowSize: 10, // Sliding window of 10 requests
};

/**
 * Circuit breaker implementation
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private config: CircuitBreakerConfig;
  private window: WindowEntry[] = [];
  private metrics: CircuitBreakerMetrics;
  private lastStateChange: number = Date.now();
  private consecutiveSuccesses = 0;
  private consecutiveFailures = 0;
  private halfOpenAttempts = 0;
  private nextHalfOpenTime = 0;
  private listeners: Map<CircuitBreakerEvent, Array<(data?: unknown) => void>> = new Map();

  constructor(private upstreamId: string, config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metrics = this.initMetrics();
  }

  /**
   * Execute request with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const startTime = process.hrtime.bigint();

    // Check if request should be allowed
    if (!this.allowRequest()) {
      this.metrics.rejectedRequests++;
      this.emit(CircuitBreakerEvent.REQUEST_REJECTED);

      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      logger.debug(`Circuit breaker rejected request in ${duration.toFixed(3)}ms`);

      throw new Error(`Circuit breaker is OPEN for upstream ${this.upstreamId}`);
    }

    try {
      const result = await fn();
      this.recordSuccess();

      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      logger.debug(`Circuit breaker request succeeded in ${duration.toFixed(3)}ms`);

      return result;
    } catch (error) {
      this.recordFailure();

      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      logger.debug(`Circuit breaker request failed in ${duration.toFixed(3)}ms`);

      throw error;
    }
  }

  /**
   * Check if request should be allowed
   */
  private allowRequest(): boolean {
    const now = Date.now();

    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        return true;

      case CircuitBreakerState.OPEN:
        // Check if timeout has elapsed
        if (now >= this.nextHalfOpenTime) {
          this.transitionTo(CircuitBreakerState.HALF_OPEN);
          return true;
        }
        return false;

      case CircuitBreakerState.HALF_OPEN:
        // Allow limited requests in half-open state
        return this.halfOpenAttempts < this.config.successThreshold;

      default:
        return false;
    }
  }

  /**
   * Record successful request
   */
  private recordSuccess(): void {
    this.addToWindow(true);
    this.metrics.totalRequests++;
    this.metrics.successfulRequests++;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;
    this.emit(CircuitBreakerEvent.REQUEST_SUCCESS);

    // Update success/failure rates
    this.updateRates();

    // State transitions
    switch (this.state) {
      case CircuitBreakerState.HALF_OPEN:
        this.halfOpenAttempts++;
        if (this.consecutiveSuccesses >= this.config.successThreshold) {
          this.transitionTo(CircuitBreakerState.CLOSED);
          this.halfOpenAttempts = 0;
        }
        break;

      case CircuitBreakerState.OPEN:
        // Should not happen, but just in case
        this.transitionTo(CircuitBreakerState.CLOSED);
        break;
    }
  }

  /**
   * Record failed request
   */
  private recordFailure(): void {
    this.addToWindow(false);
    this.metrics.totalRequests++;
    this.metrics.failedRequests++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.emit(CircuitBreakerEvent.REQUEST_FAILURE);

    // Update success/failure rates
    this.updateRates();

    // State transitions
    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        if (this.shouldOpen()) {
          this.transitionTo(CircuitBreakerState.OPEN);
          this.nextHalfOpenTime = Date.now() + this.config.timeout;
        }
        break;

      case CircuitBreakerState.HALF_OPEN:
        this.transitionTo(CircuitBreakerState.OPEN);
        this.nextHalfOpenTime = Date.now() + this.config.timeout;
        this.halfOpenAttempts = 0;
        break;
    }
  }

  /**
   * Check if circuit should open
   */
  private shouldOpen(): boolean {
    // Need enough requests in window
    if (this.window.length < this.config.windowSize) {
      return false;
    }

    // Count failures in window
    const failures = this.window.filter((e) => !e.success).length;
    return failures >= this.config.failureThreshold;
  }

  /**
   * Add entry to sliding window
   */
  private addToWindow(success: boolean): void {
    this.window.push({
      success,
      timestamp: Date.now(),
    });

    // Maintain window size
    if (this.window.length > this.config.windowSize) {
      this.window.shift();
    }
  }

  /**
   * Update success/failure rates
   */
  private updateRates(): void {
    const total = this.metrics.totalRequests;
    if (total === 0) {
      this.metrics.successRate = 0;
      this.metrics.failureRate = 0;
      return;
    }

    this.metrics.successRate = (this.metrics.successfulRequests / total) * 100;
    this.metrics.failureRate = (this.metrics.failedRequests / total) * 100;
  }

  /**
   * Transition to new state
   */
  private transitionTo(newState: CircuitBreakerState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();
    this.metrics.stateChanges++;
    this.metrics.lastStateChange = this.lastStateChange;

    logger.info(
      `Circuit breaker ${this.upstreamId}: ${oldState} -> ${newState}`
    );

    this.emit(CircuitBreakerEvent.STATE_CHANGE, {
      oldState,
      newState,
      upstreamId: this.upstreamId,
    });

    // Reset counters on state change
    if (newState === CircuitBreakerState.CLOSED) {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
      this.window = [];
    } else if (newState === CircuitBreakerState.HALF_OPEN) {
      this.consecutiveSuccesses = 0;
      this.halfOpenAttempts = 0;
      this.emit(CircuitBreakerEvent.HALF_OPEN_ATTEMPT);
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Get metrics
   */
  getMetrics(): CircuitBreakerMetrics {
    return {
      ...this.metrics,
      state: this.state,
      timeInState: Date.now() - this.lastStateChange,
    };
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.transitionTo(CircuitBreakerState.CLOSED);
    this.window = [];
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures = 0;
    this.halfOpenAttempts = 0;
    this.metrics = this.initMetrics();
    logger.info(`Circuit breaker ${this.upstreamId} reset`);
  }

  /**
   * Force state (for testing)
   */
  forceState(state: CircuitBreakerState): void {
    this.transitionTo(state);
    
    // Set nextHalfOpenTime when forcing OPEN state
    if (state === CircuitBreakerState.OPEN) {
      this.nextHalfOpenTime = Date.now() + this.config.timeout;
    }
  }

  /**
   * Add event listener
   */
  on(event: CircuitBreakerEvent, listener: (data?: unknown) => void): void {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = [];
      this.listeners.set(event, listeners);
    }
    listeners.push(listener);
  }

  /**
   * Remove event listener
   */
  off(event: CircuitBreakerEvent, listener: (data?: unknown) => void): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Emit event
   */
  private emit(event: CircuitBreakerEvent, data?: unknown): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch (error) {
          logger.error(`Circuit breaker event listener error: ${error}`);
        }
      }
    }
  }

  /**
   * Initialize metrics
   */
  private initMetrics(): CircuitBreakerMetrics {
    return {
      state: CircuitBreakerState.CLOSED,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rejectedRequests: 0,
      successRate: 0,
      failureRate: 0,
      stateChanges: 0,
      lastStateChange: Date.now(),
      timeInState: 0,
    };
  }
}
