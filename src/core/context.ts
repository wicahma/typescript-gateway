/**
 * Request context system with object pooling
 * Zero-allocation request handling through context reuse
 */

import { IncomingMessage, ServerResponse } from 'http';
import { RequestContext, HttpMethod, RouteMatch } from '../types/core.js';

/**
 * Performance tracking timestamps for request lifecycle
 */
export interface RequestTimestamps {
  routeMatch?: number;
  pluginStart?: number;
  pluginEnd?: number;
  upstreamStart?: number;
  upstreamEnd?: number;
}

/**
 * Enhanced request context with pooling support
 */
export class PoolableRequestContext implements RequestContext {
  requestId = '';
  startTime = 0n;
  method: HttpMethod = 'GET';
  path = '';
  query: Record<string, string> | null = null;
  params: Record<string, string> = {};
  headers: Record<string, string | string[] | undefined> = {};
  body: Buffer | null = null;
  req: IncomingMessage = null as unknown as IncomingMessage;
  res: ServerResponse = null as unknown as ServerResponse;
  upstream = null;
  state: Record<string, unknown> = {};
  responded = false;

  // Enhanced Phase 2 fields
  route: RouteMatch | null = null;
  timestamps: RequestTimestamps = {};

  /**
   * Reset context for reuse in pool
   * Called automatically when context is released back to pool
   */
  reset(): void {
    this.requestId = '';
    this.startTime = 0n;
    this.method = 'GET';
    this.path = '';
    this.query = null;
    this.params = {};
    this.headers = {};
    this.body = null;
    this.req = null as unknown as IncomingMessage;
    this.res = null as unknown as ServerResponse;
    this.upstream = null;
    this.state = {};
    this.responded = false;
    this.route = null;
    this.timestamps = {};
  }

  /**
   * Set matched route information
   */
  setRoute(route: RouteMatch): void {
    this.route = route;
    this.params = route.params;
    this.timestamps.routeMatch = Date.now();
  }

  /**
   * Set state value for plugins
   */
  setState(key: string, value: unknown): void {
    this.state[key] = value;
  }

  /**
   * Get state value from plugins
   */
  getState<T = unknown>(key: string): T | undefined {
    return this.state[key] as T | undefined;
  }
}

/**
 * Pool metrics for monitoring
 */
export interface PoolMetrics {
  size: number;
  available: number;
  inUse: number;
  hits: number;
  misses: number;
  totalAcquired: number;
}

/**
 * Context pool for zero-allocation request handling
 */
export class ContextPool {
  private pool: PoolableRequestContext[] = [];
  private inUse = new Set<PoolableRequestContext>();
  private hits = 0;
  private misses = 0;
  private totalAcquired = 0;
  private readonly maxSize: number;

  constructor(initialSize: number = 1000) {
    this.maxSize = initialSize;
    this.grow(initialSize);
  }

  /**
   * Acquire context from pool
   * Creates new context if pool is empty (miss)
   */
  acquire(): PoolableRequestContext {
    this.totalAcquired++;

    const ctx = this.pool.pop();
    if (ctx) {
      this.hits++;
      this.inUse.add(ctx);
      return ctx;
    }

    // Pool exhausted - create new context (miss)
    this.misses++;
    const newCtx = new PoolableRequestContext();
    this.inUse.add(newCtx);
    return newCtx;
  }

  /**
   * Release context back to pool
   * Resets context state for reuse
   */
  release(ctx: PoolableRequestContext): void {
    if (!this.inUse.has(ctx)) {
      return; // Already released or not from this pool
    }

    this.inUse.delete(ctx);
    ctx.reset();

    // Only return to pool if under max size
    if (this.pool.length < this.maxSize) {
      this.pool.push(ctx);
    }
  }

  /**
   * Grow pool by creating new contexts
   */
  private grow(count: number): void {
    for (let i = 0; i < count; i++) {
      this.pool.push(new PoolableRequestContext());
    }
  }

  /**
   * Get pool metrics for monitoring
   */
  metrics(): PoolMetrics {
    return {
      size: this.maxSize,
      available: this.pool.length,
      inUse: this.inUse.size,
      hits: this.hits,
      misses: this.misses,
      totalAcquired: this.totalAcquired,
    };
  }

  /**
   * Get hit rate percentage
   */
  getHitRate(): number {
    if (this.totalAcquired === 0) return 100;
    return (this.hits / this.totalAcquired) * 100;
  }
}
