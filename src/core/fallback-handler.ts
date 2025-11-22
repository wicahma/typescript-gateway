/**
 * Fallback Handler for Phase 7: Resilience & Error Handling
 * 
 * Implements graceful degradation with fallback responses
 * Performance target: < 1ms for fallback response generation
 */

import { GatewayError } from './errors.js';
import { logger } from '../utils/logger.js';

/**
 * Fallback response
 */
export interface FallbackResponse {
  /** HTTP status code */
  statusCode: number;
  /** Response headers */
  headers: Record<string, string>;
  /** Response body */
  body: Buffer | string;
}

/**
 * Cached response entry
 */
interface CachedResponse {
  /** Response data */
  response: FallbackResponse;
  /** Timestamp when cached */
  timestamp: number;
  /** TTL in milliseconds */
  ttl: number;
}

/**
 * Fallback configuration
 */
export interface FallbackConfig {
  /** Enable static fallback responses */
  enableStaticFallback: boolean;
  /** Enable serving stale cached responses */
  enableStaleFallback: boolean;
  /** Maximum age of stale responses in milliseconds */
  maxStaleAge: number;
  /** Default fallback status code */
  defaultStatusCode: number;
  /** Default fallback message */
  defaultMessage: string;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: FallbackConfig = {
  enableStaticFallback: true,
  enableStaleFallback: true,
  maxStaleAge: 300000, // 5 minutes
  defaultStatusCode: 503,
  defaultMessage: 'Service temporarily unavailable',
};

/**
 * Fallback context
 */
export interface FallbackContext {
  /** Route path */
  route?: string;
  /** Upstream ID */
  upstreamId?: string;
  /** Error that triggered fallback */
  error?: Error;
  /** Request ID */
  requestId?: string;
}

/**
 * Fallback Handler
 */
export class FallbackHandler {
  private config: FallbackConfig;
  private staticFallbacks: Map<string, FallbackResponse> = new Map();
  private cachedResponses: Map<string, CachedResponse> = new Map();
  private defaultTemplates: Map<number, string> = new Map();
  private fallbackCount = 0;
  private staleFallbackCount = 0;

  constructor(config?: Partial<FallbackConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeDefaultTemplates();
  }

  /**
   * Initialize default error templates
   */
  private initializeDefaultTemplates(): void {
    this.defaultTemplates.set(
      503,
      JSON.stringify({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Service temporarily unavailable. Please try again later.',
        },
      })
    );

    this.defaultTemplates.set(
      502,
      JSON.stringify({
        error: {
          code: 'BAD_GATEWAY',
          message: 'Upstream service error. Please try again later.',
        },
      })
    );

    this.defaultTemplates.set(
      504,
      JSON.stringify({
        error: {
          code: 'GATEWAY_TIMEOUT',
          message: 'Request timed out. Please try again.',
        },
      })
    );
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<FallbackConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get fallback response
   */
  getFallback(context: FallbackContext): FallbackResponse | null {
    const startTime = process.hrtime.bigint();

    // Try route-specific static fallback first
    if (this.config.enableStaticFallback && context.route) {
      const staticFallback = this.staticFallbacks.get(context.route);
      if (staticFallback) {
        this.fallbackCount++;
        logger.debug(
          `Using static fallback for route: ${context.route}`
        );
        return staticFallback;
      }

      // Try upstream-specific fallback
      if (context.upstreamId) {
        const upstreamFallback = this.staticFallbacks.get(context.upstreamId);
        if (upstreamFallback) {
          this.fallbackCount++;
          logger.debug(
            `Using static fallback for upstream: ${context.upstreamId}`
          );
          return upstreamFallback;
        }
      }
    }

    // Try stale cached response
    if (this.config.enableStaleFallback && context.route) {
      const cacheKey = this.getCacheKey(context.route, context.upstreamId);
      const cached = this.cachedResponses.get(cacheKey);

      if (cached && this.isStaleAcceptable(cached)) {
        this.fallbackCount++;
        this.staleFallbackCount++;
        
        logger.info(
          `Using stale cached response for route: ${context.route} (age: ${Date.now() - cached.timestamp}ms)`
        );

        // Add warning header to indicate stale response
        const response: FallbackResponse = {
          ...cached.response,
          headers: {
            ...cached.response.headers,
            'warning': '110 - "Response is Stale"',
            'x-served-from-cache': 'true',
          },
        };

        return response;
      }
    }

    // Use default fallback based on error
    const fallback = this.getDefaultFallback(context);
    this.fallbackCount++;

    const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    if (duration > 1.0) {
      logger.warn(
        `Fallback response generation took ${duration.toFixed(3)}ms (target: < 1ms)`
      );
    }

    return fallback;
  }

  /**
   * Get default fallback based on error
   */
  private getDefaultFallback(context: FallbackContext): FallbackResponse {
    let statusCode = this.config.defaultStatusCode;
    let message = this.config.defaultMessage;

    // Determine status code from error
    if (context.error) {
      if (context.error instanceof GatewayError) {
        statusCode = context.error.statusCode;
      } else {
        const errorMsg = context.error.message.toLowerCase();
        if (errorMsg.includes('timeout')) {
          statusCode = 504;
        } else if (errorMsg.includes('circuit') || errorMsg.includes('breaker')) {
          statusCode = 503;
        } else if (errorMsg.includes('unavailable')) {
          statusCode = 503;
        }
      }
    }

    // Get template for status code
    const template = this.defaultTemplates.get(statusCode);
    if (template) {
      message = template;
    } else {
      message = JSON.stringify({
        error: {
          code: 'SERVICE_ERROR',
          message: this.config.defaultMessage,
          statusCode,
          requestId: context.requestId,
        },
      });
    }

    return {
      statusCode,
      headers: {
        'content-type': 'application/json',
        'x-fallback-response': 'true',
      },
      body: Buffer.from(message, 'utf-8'),
    };
  }

  /**
   * Set static fallback for route
   */
  setStaticFallback(key: string, response: FallbackResponse): void {
    this.staticFallbacks.set(key, response);
    logger.debug(`Static fallback registered for: ${key}`);
  }

  /**
   * Remove static fallback
   */
  removeStaticFallback(key: string): void {
    this.staticFallbacks.delete(key);
    logger.debug(`Static fallback removed for: ${key}`);
  }

  /**
   * Cache response for potential stale serving
   */
  cacheResponse(
    route: string,
    upstreamId: string | undefined,
    response: FallbackResponse,
    ttl: number = 300000 // 5 minutes default
  ): void {
    if (!this.config.enableStaleFallback) {
      return;
    }

    const cacheKey = this.getCacheKey(route, upstreamId);
    this.cachedResponses.set(cacheKey, {
      response,
      timestamp: Date.now(),
      ttl,
    });

    logger.debug(`Response cached for potential stale serving: ${cacheKey}`);
  }

  /**
   * Clear cached response
   */
  clearCachedResponse(route: string, upstreamId?: string): void {
    const cacheKey = this.getCacheKey(route, upstreamId);
    this.cachedResponses.delete(cacheKey);
  }

  /**
   * Clear all cached responses
   */
  clearAllCached(): void {
    this.cachedResponses.clear();
    logger.info('All cached responses cleared');
  }

  /**
   * Check if stale response is acceptable
   */
  private isStaleAcceptable(cached: CachedResponse): boolean {
    const age = Date.now() - cached.timestamp;
    const maxAge = cached.ttl + this.config.maxStaleAge;
    return age <= maxAge;
  }

  /**
   * Generate cache key
   */
  private getCacheKey(route: string, upstreamId?: string): string {
    return upstreamId ? `${route}:${upstreamId}` : route;
  }

  /**
   * Set default template for status code
   */
  setDefaultTemplate(statusCode: number, template: string): void {
    this.defaultTemplates.set(statusCode, template);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalFallbacks: number;
    staleFallbacks: number;
    staticFallbackCount: number;
    cachedResponseCount: number;
  } {
    return {
      totalFallbacks: this.fallbackCount,
      staleFallbacks: this.staleFallbackCount,
      staticFallbackCount: this.staticFallbacks.size,
      cachedResponseCount: this.cachedResponses.size,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.fallbackCount = 0;
    this.staleFallbackCount = 0;
  }

  /**
   * Cleanup stale cached responses
   */
  cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, cached] of this.cachedResponses.entries()) {
      const age = now - cached.timestamp;
      const maxAge = cached.ttl + this.config.maxStaleAge;

      if (age > maxAge) {
        this.cachedResponses.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug(`Cleaned up ${removed} stale cached responses`);
    }
  }

  /**
   * Destroy handler and cleanup resources
   */
  destroy(): void {
    this.staticFallbacks.clear();
    this.cachedResponses.clear();
    logger.info('Fallback handler destroyed');
  }
}
