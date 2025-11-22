/**
 * Retry Manager for Phase 7: Resilience & Error Handling
 * 
 * Implements intelligent retry strategies with exponential backoff and jitter
 * Performance target: < 0.1ms for retry decision
 */

import { CircuitBreaker } from './circuit-breaker.js';
import { GatewayError, isRetryable } from './errors.js';
import { logger } from '../utils/logger.js';

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum retry attempts */
  maxAttempts: number;
  /** Initial delay in milliseconds */
  initialDelay: number;
  /** Maximum delay in milliseconds */
  maxDelay: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Enable jitter to prevent thundering herd */
  jitter: boolean;
  /** HTTP status codes that are retryable */
  retryableStatuses: number[];
  /** HTTP methods that are retryable (idempotent only) */
  retryableMethods: string[];
  /** Total retry budget timeout in milliseconds */
  timeout: number;
}

/**
 * Default retry configuration
 */
const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelay: 100,
  maxDelay: 5000,
  backoffMultiplier: 2,
  jitter: true,
  retryableStatuses: [502, 503, 504, 408, 429],
  retryableMethods: ['GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
  timeout: 30000,
};

/**
 * Retry attempt information
 */
export interface RetryAttempt {
  /** Attempt number (1-indexed) */
  attempt: number;
  /** Delay before this attempt in milliseconds */
  delay: number;
  /** Total elapsed time in milliseconds */
  elapsedTime: number;
  /** Error from previous attempt */
  error?: Error;
}

/**
 * Retry context
 */
export interface RetryContext {
  /** HTTP method */
  method: string;
  /** Request path */
  path: string;
  /** Upstream ID */
  upstreamId?: string;
  /** Circuit breaker instance */
  circuitBreaker?: CircuitBreaker;
}

/**
 * Retry result
 */
export interface RetryResult<T> {
  /** Result value if successful */
  value?: T;
  /** Error if all attempts failed */
  error?: Error;
  /** Number of attempts made */
  attempts: number;
  /** Total time taken in milliseconds */
  totalTime: number;
  /** Whether result is from successful retry */
  retried: boolean;
}

/**
 * Retry Manager
 */
export class RetryManager {
  private config: RetryConfig;
  private activeRetries = 0;
  private totalRetries = 0;
  private successfulRetries = 0;
  private failedRetries = 0;

  constructor(config?: Partial<RetryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RetryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Execute function with retry logic
   */
  async execute<T>(
    fn: () => Promise<T>,
    context: RetryContext,
    config?: Partial<RetryConfig>
  ): Promise<RetryResult<T>> {
    const retryConfig = { ...this.config, ...config };
    const startTime = Date.now();
    const attempts: RetryAttempt[] = [];

    // Check if method is retryable
    if (!this.isMethodRetryable(context.method, retryConfig)) {
      try {
        const value = await fn();
        return {
          value,
          attempts: 1,
          totalTime: Date.now() - startTime,
          retried: false,
        };
      } catch (error) {
        return {
          error: error as Error,
          attempts: 1,
          totalTime: Date.now() - startTime,
          retried: false,
        };
      }
    }

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      // Check if we've exceeded retry budget
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime >= retryConfig.timeout) {
        logger.debug(
          `Retry budget exceeded: ${elapsedTime}ms >= ${retryConfig.timeout}ms`
        );
        break;
      }

      // Check circuit breaker before retry
      if (attempt > 1 && context.circuitBreaker) {
        const state = context.circuitBreaker.getState();
        if (state === 'OPEN') {
          logger.debug(
            `Circuit breaker is OPEN for ${context.upstreamId}, skipping retry`
          );
          break;
        }
      }

      // Calculate delay for this attempt (skip delay for first attempt)
      let delay = 0;
      if (attempt > 1) {
        delay = this.calculateDelay(attempt - 1, retryConfig);
        
        // Ensure delay doesn't exceed remaining budget
        const remainingBudget = retryConfig.timeout - elapsedTime;
        if (delay > remainingBudget) {
          delay = remainingBudget;
        }

        logger.debug(
          `Retry attempt ${attempt}/${retryConfig.maxAttempts} after ${delay}ms delay`
        );

        await this.sleep(delay);
      }

      attempts.push({
        attempt,
        delay,
        elapsedTime: Date.now() - startTime,
      });

      try {
        this.activeRetries++;
        const value = await fn();
        this.activeRetries--;

        const totalTime = Date.now() - startTime;
        const retried = attempt > 1;

        if (retried) {
          this.totalRetries++;
          this.successfulRetries++;
          logger.info(
            `Request succeeded on retry attempt ${attempt} after ${totalTime}ms`
          );
        }

        return {
          value,
          attempts: attempt,
          totalTime,
          retried,
        };
      } catch (error) {
        this.activeRetries--;
        lastError = error as Error;
        
        const lastAttempt = attempts[attempts.length - 1];
        if (lastAttempt) {
          lastAttempt.error = lastError;
        }

        // Check if error is retryable
        if (!this.shouldRetry(lastError, retryConfig)) {
          logger.debug(`Error is not retryable: ${lastError.message}`);
          break;
        }

        // Check if we have more attempts
        if (attempt >= retryConfig.maxAttempts) {
          logger.debug(
            `Maximum retry attempts (${retryConfig.maxAttempts}) reached`
          );
          break;
        }

        logger.debug(
          `Attempt ${attempt} failed: ${lastError.message}, will retry`
        );
      }
    }

    // All attempts failed
    this.totalRetries++;
    this.failedRetries++;

    const totalTime = Date.now() - startTime;
    logger.warn(
      `All retry attempts failed after ${totalTime}ms: ${lastError?.message}`
    );

    return {
      error: lastError,
      attempts: attempts.length,
      totalTime,
      retried: attempts.length > 1,
    };
  }

  /**
   * Check if HTTP method is retryable
   */
  private isMethodRetryable(method: string, config: RetryConfig): boolean {
    // Normalize method once and use the normalized version
    const normalizedMethod = method.toUpperCase();
    return config.retryableMethods.includes(normalizedMethod);
  }

  /**
   * Check if error should trigger retry
   */
  private shouldRetry(error: Error, config: RetryConfig): boolean {
    // Check if error is marked as retryable
    if (!isRetryable(error)) {
      return false;
    }

    // Check if status code is retryable (for GatewayError)
    if (error instanceof GatewayError) {
      return config.retryableStatuses.includes(error.statusCode);
    }

    // For non-GatewayError, use message-based heuristics
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('ehostunreach') ||
      message.includes('enetunreach') ||
      message.includes('unavailable')
    );
  }

  /**
   * Calculate delay for retry attempt with exponential backoff and jitter
   */
  private calculateDelay(attempt: number, config: RetryConfig): number {
    // Calculate exponential backoff
    let delay = config.initialDelay * Math.pow(config.backoffMultiplier, attempt);

    // Cap at max delay
    delay = Math.min(delay, config.maxDelay);

    // Apply jitter if enabled (full jitter: random between 0 and delay)
    if (config.jitter) {
      delay = Math.random() * delay;
    }

    return Math.floor(delay);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get retry statistics
   */
  getStats(): {
    activeRetries: number;
    totalRetries: number;
    successfulRetries: number;
    failedRetries: number;
    successRate: number;
  } {
    const successRate =
      this.totalRetries > 0
        ? (this.successfulRetries / this.totalRetries) * 100
        : 0;

    return {
      activeRetries: this.activeRetries,
      totalRetries: this.totalRetries,
      successfulRetries: this.successfulRetries,
      failedRetries: this.failedRetries,
      successRate,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.totalRetries = 0;
    this.successfulRetries = 0;
    this.failedRetries = 0;
  }
}
