/**
 * High-performance object pooling system
 * Minimizes GC pressure by reusing objects
 * Designed for lock-free access patterns where possible
 */

/**
 * Poolable object interface
 * Objects in pool must implement reset method
 */
export interface Poolable {
  reset(): void;
}

/**
 * Pool statistics for monitoring
 */
export interface PoolStats {
  /** Total objects in pool */
  size: number;
  /** Available objects */
  available: number;
  /** In-use objects */
  inUse: number;
  /** Total acquisitions */
  hits: number;
  /** Times pool was empty (new allocation) */
  misses: number;
  /** Total allocations */
  allocations: number;
}

/**
 * Factory function for creating new pool objects
 */
export type PoolFactory<T> = () => T;

/**
 * Generic object pool implementation
 * Fixed-size pool with overflow handling
 */
export class ObjectPool<T extends Poolable> {
  private pool: T[] = [];
  private size: number;
  private factory: PoolFactory<T>;
  private stats: PoolStats;

  constructor(factory: PoolFactory<T>, size: number = 100) {
    this.factory = factory;
    this.size = size;
    this.stats = {
      size,
      available: 0,
      inUse: 0,
      hits: 0,
      misses: 0,
      allocations: 0,
    };

    // Pre-allocate pool
    this.preallocate();
  }

  /**
   * Pre-allocate all pool objects
   * Done at initialization to avoid allocations during runtime
   */
  private preallocate(): void {
    for (let i = 0; i < this.size; i++) {
      this.pool.push(this.factory());
      this.stats.allocations++;
    }
    this.stats.available = this.size;
  }

  /**
   * Acquire object from pool
   * Returns new object if pool is empty (overflow)
   */
  acquire(): T {
    const obj = this.pool.pop();

    if (obj) {
      this.stats.hits++;
      this.stats.available--;
      this.stats.inUse++;
      return obj;
    }

    // Pool empty - allocate new object (overflow)
    this.stats.misses++;
    this.stats.inUse++;
    this.stats.allocations++;
    return this.factory();
  }

  /**
   * Release object back to pool
   * Resets object state before returning to pool
   */
  release(obj: T): void {
    // Reset object state
    obj.reset();

    // Return to pool if under size limit
    if (this.pool.length < this.size) {
      this.pool.push(obj);
      this.stats.available++;
    }
    // Otherwise let it be GC'd (overflow object)

    this.stats.inUse--;
  }

  /**
   * Get pool statistics
   */
  getStats(): Readonly<PoolStats> {
    return { ...this.stats };
  }

  /**
   * Clear pool and reset statistics
   */
  clear(): void {
    this.pool = [];
    this.stats.available = 0;
    this.stats.inUse = 0;
    this.preallocate();
  }

  /**
   * Get current pool size
   */
  getSize(): number {
    return this.size;
  }

  /**
   * Resize pool (creates new pool)
   */
  resize(newSize: number): void {
    this.size = newSize;
    this.clear();
  }
}

/**
 * Wrapper for Buffer to add Poolable interface
 */
class PoolableBuffer implements Poolable {
  buffer: Buffer;

  constructor(size: number) {
    this.buffer = Buffer.allocUnsafe(size);
  }

  reset(): void {
    this.buffer.fill(0);
  }
}

/**
 * Buffer pool for reusing byte buffers
 * Uses wrapper class to avoid monkey-patching Buffer prototype
 */
export class BufferPool {
  private pools: Map<number, ObjectPool<PoolableBuffer>>;
  private defaultSize: number;

  constructor(defaultSize: number = 8192) {
    this.defaultSize = defaultSize;
    this.pools = new Map();
  }

  /**
   * Get or create pool for specific buffer size
   */
  private getPool(size: number): ObjectPool<PoolableBuffer> {
    let pool = this.pools.get(size);

    if (!pool) {
      pool = new ObjectPool(() => new PoolableBuffer(size), 100);
      this.pools.set(size, pool);
    }

    return pool;
  }

  /**
   * Acquire buffer of specified size
   */
  acquire(size?: number): Buffer {
    const bufferSize = size || this.defaultSize;
    const pool = this.getPool(bufferSize);
    const poolable = pool.acquire();
    return poolable.buffer;
  }

  /**
   * Release buffer back to pool
   */
  release(buffer: Buffer): void {
    const pool = this.getPool(buffer.length);
    const poolable = new PoolableBuffer(buffer.length);
    poolable.buffer = buffer;
    pool.release(poolable);
  }

  /**
   * Get statistics for all buffer pools
   */
  getStats(): Map<number, PoolStats> {
    const stats = new Map<number, PoolStats>();
    this.pools.forEach((pool, size) => {
      stats.set(size, pool.getStats());
    });
    return stats;
  }

  /**
   * Clear all buffer pools
   */
  clear(): void {
    this.pools.forEach(pool => pool.clear());
  }
}
