/**
 * Rate Limit Plugin
 * Production-grade rate limiting with multiple strategies
 * Phase 5: Advanced Features
 */

import { Plugin } from '../../types/plugin.js';
import { RequestContext } from '../../types/core.js';
import { TokenBucketRateLimiter, SlidingWindowRateLimiter, RateLimitResult } from '../../core/rate-limiter.js';
import { logger } from '../../utils/logger.js';

/**
 * Rate limit strategy type
 */
export type RateLimitStrategyType = 'token-bucket' | 'sliding-window';

/**
 * Key extractor type
 */
export type KeyExtractor = 'ip' | 'header' | 'upstream';

/**
 * Rate limit strategy configuration
 */
export interface RateLimitStrategy {
  /** Strategy name */
  name: string;
  /** Strategy type */
  type: RateLimitStrategyType;
  /** Token bucket: capacity */
  capacity?: number;
  /** Token bucket: refill rate (tokens/sec) */
  refillRate?: number;
  /** Sliding window: window duration in ms */
  windowMs?: number;
  /** Sliding window: max requests per window */
  maxRequests?: number;
  /** Key extractor */
  keyExtractor: KeyExtractor;
  /** Header name for 'header' extractor */
  headerName?: string;
  /** Routes to apply (glob patterns) */
  routes?: string[];
  /** Upstream name for 'upstream' extractor */
  upstream?: string;
  /** Status code to return when rate limited */
  statusCode?: number;
  /** Message to return when rate limited */
  message?: string;
  /** Enable rate limit headers */
  includeHeaders?: boolean;
}

/**
 * Rate limit plugin configuration
 */
export interface RateLimitConfig {
  /** Enable rate limiting */
  enabled: boolean;
  /** Rate limit strategies */
  strategies: RateLimitStrategy[];
  /** Global rate limit headers */
  includeHeaders?: boolean;
}

/**
 * Rate limit plugin
 * Implements multiple rate limiting strategies
 */
export class RateLimitPlugin implements Plugin {
  name = 'rate-limit';
  version = '1.0.0';
  description = 'Production-grade rate limiting with multiple strategies';
  author = 'Gateway Team';

  private config: RateLimitConfig = {
    enabled: true,
    strategies: [],
    includeHeaders: true,
  };

  private limiters = new Map<string, TokenBucketRateLimiter | SlidingWindowRateLimiter>();

  init(config: Record<string, unknown>): void {
    if ('enabled' in config && config['enabled'] !== undefined) {
      this.config.enabled = Boolean(config['enabled']);
    }

    if ('includeHeaders' in config && config['includeHeaders'] !== undefined) {
      this.config.includeHeaders = Boolean(config['includeHeaders']);
    }

    if ('strategies' in config && Array.isArray(config['strategies'])) {
      this.config.strategies = config['strategies'] as RateLimitStrategy[];

      // Initialize limiters for each strategy
      for (const strategy of this.config.strategies) {
        this.initStrategy(strategy);
      }
    }

    logger.info({ strategies: this.config.strategies.length }, 'Rate limiting initialized');
  }

  preRoute(ctx: RequestContext): void {
    if (!this.config.enabled) {
      return;
    }

    // Apply each matching strategy
    for (const strategy of this.config.strategies) {
      // Check if route matches
      if (!this.matchesRoute(ctx.path, strategy.routes)) {
        continue;
      }

      // Extract key based on strategy
      const key = this.extractKey(ctx, strategy);
      if (!key) {
        continue;
      }

      // Get limiter for this strategy
      const limiter = this.limiters.get(strategy.name);
      if (!limiter) {
        continue;
      }

      // Check rate limit
      const result = limiter.consume(key);

      // Add headers if configured
      const includeHeaders = strategy.includeHeaders ?? this.config.includeHeaders ?? true;
      if (includeHeaders) {
        this.addRateLimitHeaders(ctx, result);
      }

      // If not allowed, reject request
      if (!result.allowed) {
        const statusCode = strategy.statusCode ?? 429;
        const message = strategy.message ?? 'Too Many Requests';

        ctx.res.statusCode = statusCode;
        ctx.res.setHeader('Content-Type', 'application/json');
        
        if (result.retryAfter) {
          ctx.res.setHeader('Retry-After', Math.ceil(result.retryAfter).toString());
        }

        ctx.res.end(JSON.stringify({
          error: message,
          limit: result.limit,
          remaining: result.remaining,
          resetIn: result.resetIn,
          retryAfter: result.retryAfter,
        }));

        ctx.responded = true;

        logger.warn({
          requestId: ctx.requestId,
          strategy: strategy.name,
          key,
          limit: result.limit,
        }, 'Rate limit exceeded');

        return;
      }
    }
  }

  destroy(): void {
    this.limiters.clear();
  }

  /**
   * Initialize a rate limit strategy
   */
  private initStrategy(strategy: RateLimitStrategy): void {
    if (strategy.type === 'token-bucket') {
      const capacity = strategy.capacity ?? 100;
      const refillRate = strategy.refillRate ?? 10;

      this.limiters.set(strategy.name, new TokenBucketRateLimiter({
        capacity,
        refillRate,
        maxBuckets: 100000,
      }));
    } else if (strategy.type === 'sliding-window') {
      const windowMs = strategy.windowMs ?? 60000;
      const maxRequests = strategy.maxRequests ?? 1000;

      this.limiters.set(strategy.name, new SlidingWindowRateLimiter({
        windowMs,
        maxRequests,
        maxWindows: 100000,
      }));
    }
  }

  /**
   * Extract rate limit key based on strategy
   */
  private extractKey(ctx: RequestContext, strategy: RateLimitStrategy): string | null {
    switch (strategy.keyExtractor) {
      case 'ip': {
        const ip = ctx.req.socket.remoteAddress;
        return ip ? `ip:${ip}` : null;
      }

      case 'header': {
        const headerName = strategy.headerName;
        if (!headerName) {
          return null;
        }
        const value = ctx.headers[headerName.toLowerCase()];
        if (!value) {
          return null;
        }
        return `header:${headerName}:${Array.isArray(value) ? value[0] : value}`;
      }

      case 'upstream': {
        const upstream = strategy.upstream ?? ctx.upstream?.id;
        return upstream ? `upstream:${upstream}` : null;
      }

      default:
        return null;
    }
  }

  /**
   * Check if path matches route patterns
   */
  private matchesRoute(path: string, routes?: string[]): boolean {
    if (!routes || routes.length === 0) {
      return true; // No route filter means match all
    }

    for (const route of routes) {
      if (this.matchPattern(path, route)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Match path against pattern (supports * wildcard)
   */
  private matchPattern(path: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\//g, '\\/');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  /**
   * Add rate limit headers to response
   */
  private addRateLimitHeaders(ctx: RequestContext, result: RateLimitResult): void {
    ctx.res.setHeader('X-RateLimit-Limit', result.limit.toString());
    ctx.res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
    ctx.res.setHeader('X-RateLimit-Reset', (Date.now() + result.resetIn * 1000).toString());
  }

  /**
   * Get rate limiter statistics
   */
  public getStats(): Record<string, unknown> {
    const stats: Record<string, unknown> = {};

    for (const [name, limiter] of this.limiters.entries()) {
      stats[name] = limiter.getStats();
    }

    return stats;
  }
}

/**
 * Create rate limit plugin instance
 */
export function createRateLimitPlugin(config?: Partial<RateLimitConfig>): RateLimitPlugin {
  const plugin = new RateLimitPlugin();
  if (config) {
    plugin.init(config as Record<string, unknown>);
  }
  return plugin;
}
