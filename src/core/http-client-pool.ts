import http from 'http';
import https from 'https';
import { ConnectionPoolConfig, UpstreamTarget } from '../types/core.js';
import { logger } from '../utils/logger.js';

/**
 * Pooled connection wrapper
 */
interface PooledConnection {
  /** HTTP/HTTPS agent */
  agent: http.Agent | https.Agent;
  /** Last used timestamp */
  lastUsed: number;
  /** Number of times used */
  useCount: number;
  /** Whether connection is currently in use */
  inUse: boolean;
  /** Connection creation timestamp */
  created: number;
}

/**
 * Connection pool metrics
 */
export interface PoolMetrics {
  /** Total connections */
  total: number;
  /** Active connections */
  active: number;
  /** Idle connections */
  idle: number;
  /** Total requests */
  totalRequests: number;
  /** Reused connections */
  reusedConnections: number;
  /** Reuse rate percentage */
  reuseRate: number;
  /** Total errors */
  errors: number;
}

/**
 * Default connection pool configuration
 */
const DEFAULT_POOL_CONFIG: ConnectionPoolConfig = {
  minSize: 1,
  maxSize: 10,
  idleTimeout: 60000, // 60 seconds
  connectionTimeout: 5000, // 5 seconds
  requestTimeout: 30000, // 30 seconds
  http2: false,
};

/**
 * HTTP client connection pool
 */
export class HttpClientPool {
  private pools: Map<string, PooledConnection[]> = new Map();
  private config: ConnectionPoolConfig;
  private metrics: Map<string, PoolMetrics> = new Map();
  private poolSizes: Map<string, number> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config?: Partial<ConnectionPoolConfig>) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };

    // Start cleanup timer
    this.startCleanup();
  }

  /**
   * Set per-upstream socket ceiling from route config poolSize
   */
  configure(upstreams: Array<{ id: string; poolSize?: number }>): void {
    for (const u of upstreams) {
      if (u.poolSize && u.poolSize > 0) this.poolSizes.set(u.id, u.poolSize);
    }
  }

  private maxSizeFor(upstream: UpstreamTarget): number {
    return this.poolSizes.get(upstream.id) ?? this.config.maxSize;
  }

  /**
   * Acquire connection from pool
   */
  async acquire(upstream: UpstreamTarget): Promise<http.Agent | https.Agent> {
    const poolKey = this.getPoolKey(upstream);

    let pool = this.pools.get(poolKey);
    if (pool === undefined) {
      pool = [];
      this.pools.set(poolKey, pool);
    }

    // ponytail: fast path — reuse an idle connection without hrtime timing or
    // logger.debug; metrics bookkeeping stays (cheap counter/filter pass).
    // Upgrade path: per-pool free-list head pointer if profiled as a hotspot.
    const connection = this.getIdleConnection(pool);
    if (connection) {
      connection.inUse = true;
      connection.lastUsed = Date.now();
      connection.useCount++;
      this.updateMetrics(poolKey, true);
      return connection.agent;
    }

    if (pool.length < this.maxSizeFor(upstream)) {
      const created = this.createConnection(upstream);
      pool.push(created);
      created.inUse = true;
      created.lastUsed = Date.now();
      created.useCount = 1;
      this.updateMetrics(poolKey, false);
      return created.agent;
    }

    const waited = await this.waitForConnection(pool, this.config.connectionTimeout);
    waited.inUse = true;
    waited.lastUsed = Date.now();
    waited.useCount++;
    this.updateMetrics(poolKey, waited.useCount > 1);
    return waited.agent;
  }

  /**
   * Release connection back to pool
   */
  release(upstream: UpstreamTarget, agent: http.Agent | https.Agent): void {
    const poolKey = this.getPoolKey(upstream);
    const pool = this.pools.get(poolKey);

    if (!pool) return;

    const connection = pool.find((c) => c.agent === agent);
    if (connection) {
      connection.inUse = false;
      connection.lastUsed = Date.now();
    }
  }

  /**
   * Remove connection from pool
   */
  remove(upstream: UpstreamTarget, agent: http.Agent | https.Agent): void {
    const poolKey = this.getPoolKey(upstream);
    const pool = this.pools.get(poolKey);

    if (!pool) return;

    const index = pool.findIndex((c) => c.agent === agent);
    if (index !== -1) {
      const connection = pool[index];
      if (connection) {
        connection.agent.destroy();
        pool.splice(index, 1);
      }
    }
  }

  /**
   * Get pool metrics
   */
  getMetrics(upstream: UpstreamTarget): PoolMetrics {
    const poolKey = this.getPoolKey(upstream);
    const metrics = this.metrics.get(poolKey);

    if (!metrics) {
      return {
        total: 0,
        active: 0,
        idle: 0,
        totalRequests: 0,
        reusedConnections: 0,
        reuseRate: 0,
        errors: 0,
      };
    }

    return { ...metrics };
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): Map<string, PoolMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Destroy pool
   */
  destroy(): void {
    // Stop cleanup
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Destroy all connections
    for (const pool of this.pools.values()) {
      for (const connection of pool) {
        connection.agent.destroy();
      }
    }

    this.pools.clear();
    this.metrics.clear();
  }

  /**
   * Get idle connection from pool
   */
  private getIdleConnection(pool: PooledConnection[]): PooledConnection | null {
    for (const connection of pool) {
      if (!connection.inUse) {
        // Check if connection is still healthy
        const age = Date.now() - connection.lastUsed;
        if (age < this.config.idleTimeout) {
          return connection;
        }
      }
    }
    return null;
  }

  /**
   * Wait for connection to become available
   */
  private waitForConnection(
    pool: PooledConnection[],
    timeout: number
  ): Promise<PooledConnection> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkInterval = 10; // Check every 10ms

      const timer = setInterval(() => {
        const connection = this.getIdleConnection(pool);
        if (connection) {
          clearInterval(timer);
          resolve(connection);
          return;
        }

        // Check timeout
        if (Date.now() - startTime > timeout) {
          clearInterval(timer);
          reject(new Error(`Connection acquisition timeout after ${timeout}ms`));
        }
      }, checkInterval);
    });
  }

  /**
   * Create new connection
   */
  private createConnection(upstream: UpstreamTarget): PooledConnection {
    const isHttps = upstream.protocol === 'https';
    const size = this.maxSizeFor(upstream);

    const agentOptions: http.AgentOptions = {
      keepAlive: true,
      keepAliveMsecs: 1000,
      maxSockets: size,
      maxFreeSockets: size,
      timeout: this.config.requestTimeout,
    };

    const agent = isHttps
      ? new https.Agent(agentOptions)
      : new http.Agent(agentOptions);

    return {
      agent,
      lastUsed: Date.now(),
      useCount: 0,
      inUse: false,
      created: Date.now(),
    };
  }

  /**
   * Get pool key for upstream
   */
  private getPoolKey(upstream: UpstreamTarget): string {
    return `${upstream.protocol}://${upstream.host}:${upstream.port}`;
  }

  /**
   * Update metrics
   */
  private updateMetrics(poolKey: string, isReused: boolean): void {
    let metrics = this.metrics.get(poolKey);

    if (!metrics) {
      metrics = {
        total: 0,
        active: 0,
        idle: 0,
        totalRequests: 0,
        reusedConnections: 0,
        reuseRate: 0,
        errors: 0,
      };
      this.metrics.set(poolKey, metrics);
    }

    const pool = this.pools.get(poolKey);
    if (pool) {
      metrics.total = pool.length;
      metrics.active = pool.filter((c) => c.inUse).length;
      metrics.idle = pool.filter((c) => !c.inUse).length;
    }

    metrics.totalRequests++;
    if (isReused) {
      metrics.reusedConnections++;
    }

    metrics.reuseRate =
      metrics.totalRequests > 0
        ? (metrics.reusedConnections / metrics.totalRequests) * 100
        : 0;
  }

  /**
   * Start cleanup timer
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections();
    }, 30000); // Check every 30 seconds
  }

  /**
   * Cleanup idle connections
   */
  private cleanupIdleConnections(): void {
    const now = Date.now();

    for (const [poolKey, pool] of this.pools.entries()) {
      // Remove idle connections that exceeded idle timeout
      const toRemove: number[] = [];

      for (let i = 0; i < pool.length; i++) {
        const connection = pool[i];
        if (connection && !connection.inUse) {
          const idleTime = now - connection.lastUsed;
          if (idleTime > this.config.idleTimeout) {
            toRemove.push(i);
          }
        }
      }

      // Remove from end to beginning to maintain indices
      for (let i = toRemove.length - 1; i >= 0; i--) {
        const index = toRemove[i];
        if (index !== undefined) {
          const connection = pool[index];
          if (connection !== undefined) {
            connection.agent.destroy();
            pool.splice(index, 1);
            logger.debug(`Removed idle connection from pool ${poolKey}`);
          }
        }
      }

      // Ensure minimum pool size
      while (pool.length < this.config.minSize) {
        // We need upstream target, but we can't create it from poolKey alone
        // This is a limitation - we'll handle it in acquire method
        break;
      }
    }
  }
}
