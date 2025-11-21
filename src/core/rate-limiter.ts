/**
 * Token Bucket Rate Limiter
 * High-performance rate limiting with LRU eviction
 * Phase 5: Advanced Features
 */

/**
 * Token bucket configuration
 */
export interface TokenBucketConfig {
  /** Maximum number of tokens (burst capacity) */
  capacity: number;
  /** Tokens refilled per second */
  refillRate: number;
  /** Maximum number of buckets to track (LRU eviction) */
  maxBuckets?: number;
}

/**
 * Token bucket state
 */
interface TokenBucket {
  /** Current number of tokens */
  tokens: number;
  /** Last refill timestamp in milliseconds */
  lastRefill: number;
  /** Last access timestamp for LRU eviction */
  lastAccess: number;
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining tokens */
  remaining: number;
  /** Total capacity */
  limit: number;
  /** Time until next token refill in seconds */
  resetIn: number;
  /** Retry after in seconds (when not allowed) */
  retryAfter?: number;
}

/**
 * Token Bucket Rate Limiter
 * Implements high-performance token bucket algorithm with LRU eviction
 */
export class TokenBucketRateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private config: Required<TokenBucketConfig>;
  private lruKeys: string[] = [];

  constructor(config: TokenBucketConfig) {
    this.config = {
      capacity: config.capacity,
      refillRate: config.refillRate,
      maxBuckets: config.maxBuckets ?? 100000,
    };
  }

  /**
   * Check if request is allowed and consume a token
   */
  public consume(key: string, tokens = 1): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = {
        tokens: this.config.capacity,
        lastRefill: now,
        lastAccess: now,
      };
      this.setBucket(key, bucket);
    } else {
      // Refill tokens based on time elapsed
      const elapsed = (now - bucket.lastRefill) / 1000; // Convert to seconds
      const tokensToAdd = Math.floor(elapsed * this.config.refillRate);

      if (tokensToAdd > 0) {
        bucket.tokens = Math.min(this.config.capacity, bucket.tokens + tokensToAdd);
        bucket.lastRefill = now;
      }

      bucket.lastAccess = now;
    }

    // Check if we have enough tokens
    const allowed = bucket.tokens >= tokens;
    
    // Consume tokens if allowed
    if (allowed) {
      bucket.tokens -= tokens;
    }

    const remaining = Math.max(0, bucket.tokens);
    const resetIn = bucket.tokens < this.config.capacity 
      ? (this.config.capacity - bucket.tokens) / this.config.refillRate 
      : 0;

    const result: RateLimitResult = {
      allowed,
      remaining,
      limit: this.config.capacity,
      resetIn,
    };

    if (!allowed) {
      // Calculate retry after time (when will we have enough tokens)
      const tokensNeeded = tokens - bucket.tokens;
      result.retryAfter = tokensNeeded / this.config.refillRate;
    }

    return result;
  }

  /**
   * Check rate limit without consuming tokens
   */
  public check(key: string): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      return {
        allowed: true,
        remaining: this.config.capacity,
        limit: this.config.capacity,
        resetIn: 0,
      };
    }

    // Calculate current tokens without modifying state
    const elapsed = (now - bucket.lastRefill) / 1000;
    const tokensToAdd = Math.floor(elapsed * this.config.refillRate);
    const currentTokens = Math.min(this.config.capacity, bucket.tokens + tokensToAdd);

    return {
      allowed: currentTokens > 0,
      remaining: Math.max(0, currentTokens),
      limit: this.config.capacity,
      resetIn: currentTokens < this.config.capacity 
        ? (this.config.capacity - currentTokens) / this.config.refillRate 
        : 0,
    };
  }

  /**
   * Reset rate limit for a key
   */
  public reset(key: string): void {
    this.buckets.delete(key);
    const index = this.lruKeys.indexOf(key);
    if (index > -1) {
      this.lruKeys.splice(index, 1);
    }
  }

  /**
   * Clear all rate limits
   */
  public clear(): void {
    this.buckets.clear();
    this.lruKeys = [];
  }

  /**
   * Get statistics
   */
  public getStats(): {
    totalBuckets: number;
    maxBuckets: number;
    memoryUsage: number;
  } {
    return {
      totalBuckets: this.buckets.size,
      maxBuckets: this.config.maxBuckets,
      memoryUsage: this.estimateMemoryUsage(),
    };
  }

  /**
   * Set bucket with LRU eviction
   */
  private setBucket(key: string, bucket: TokenBucket): void {
    // Check if we need to evict
    if (this.buckets.size >= this.config.maxBuckets && !this.buckets.has(key)) {
      this.evictLRU();
    }

    this.buckets.set(key, bucket);
    
    // Update LRU list
    const index = this.lruKeys.indexOf(key);
    if (index > -1) {
      this.lruKeys.splice(index, 1);
    }
    this.lruKeys.push(key);
  }

  /**
   * Evict least recently used bucket
   */
  private evictLRU(): void {
    if (this.lruKeys.length === 0) {
      // Fallback: find oldest by lastAccess
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [key, bucket] of this.buckets.entries()) {
        if (bucket.lastAccess < oldestTime) {
          oldestTime = bucket.lastAccess;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.buckets.delete(oldestKey);
      }
    } else {
      // Evict from LRU list
      const keyToEvict = this.lruKeys.shift();
      if (keyToEvict) {
        this.buckets.delete(keyToEvict);
      }
    }
  }

  /**
   * Estimate memory usage in bytes
   */
  private estimateMemoryUsage(): number {
    // Rough estimate: 
    // - Each key (string): ~50 bytes average
    // - Each TokenBucket: 24 bytes (3 numbers * 8 bytes)
    // - Map overhead: ~50 bytes per entry
    const bytesPerEntry = 50 + 24 + 50;
    return this.buckets.size * bytesPerEntry;
  }
}

/**
 * Sliding Window Counter Configuration
 */
export interface SlidingWindowConfig {
  /** Window duration in milliseconds */
  windowMs: number;
  /** Maximum requests per window */
  maxRequests: number;
  /** Maximum number of windows to track */
  maxWindows?: number;
}

/**
 * Window state for sliding window counter
 */
interface WindowState {
  /** Request timestamps within window */
  requests: number[];
  /** Last access time for LRU */
  lastAccess: number;
}

/**
 * Sliding Window Counter Rate Limiter
 * Alternative algorithm for rate limiting
 */
export class SlidingWindowRateLimiter {
  private windows = new Map<string, WindowState>();
  private config: Required<SlidingWindowConfig>;
  private lruKeys: string[] = [];

  constructor(config: SlidingWindowConfig) {
    this.config = {
      windowMs: config.windowMs,
      maxRequests: config.maxRequests,
      maxWindows: config.maxWindows ?? 100000,
    };
  }

  /**
   * Check if request is allowed
   */
  public consume(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    let window = this.windows.get(key);

    if (!window) {
      window = {
        requests: [],
        lastAccess: now,
      };
      this.setWindow(key, window);
    } else {
      // Remove expired requests
      window.requests = window.requests.filter((time) => time > windowStart);
      window.lastAccess = now;
    }

    // Check if we can add this request
    const allowed = window.requests.length < this.config.maxRequests;
    
    // Add current request if allowed
    if (allowed) {
      window.requests.push(now);
    }

    const remaining = Math.max(0, this.config.maxRequests - window.requests.length);

    // Calculate reset time (when oldest request expires)
    const resetIn = window.requests.length > 0 && window.requests[0] !== undefined
      ? Math.max(0, (window.requests[0] + this.config.windowMs - now) / 1000)
      : 0;

    const result: RateLimitResult = {
      allowed,
      remaining,
      limit: this.config.maxRequests,
      resetIn,
    };

    if (!allowed && window.requests.length > 0 && window.requests[0] !== undefined) {
      result.retryAfter = (window.requests[0] + this.config.windowMs - now) / 1000;
    }

    return result;
  }

  /**
   * Check rate limit without consuming
   */
  public check(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    const window = this.windows.get(key);

    if (!window) {
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        limit: this.config.maxRequests,
        resetIn: 0,
      };
    }

    const validRequests = window.requests.filter((time) => time > windowStart);
    const remaining = Math.max(0, this.config.maxRequests - validRequests.length);
    const resetIn = validRequests.length > 0 && validRequests[0] !== undefined
      ? Math.max(0, (validRequests[0] + this.config.windowMs - now) / 1000)
      : 0;

    return {
      allowed: validRequests.length < this.config.maxRequests,
      remaining,
      limit: this.config.maxRequests,
      resetIn,
    };
  }

  /**
   * Reset rate limit for a key
   */
  public reset(key: string): void {
    this.windows.delete(key);
    const index = this.lruKeys.indexOf(key);
    if (index > -1) {
      this.lruKeys.splice(index, 1);
    }
  }

  /**
   * Clear all rate limits
   */
  public clear(): void {
    this.windows.clear();
    this.lruKeys = [];
  }

  /**
   * Get statistics
   */
  public getStats(): {
    totalWindows: number;
    maxWindows: number;
    memoryUsage: number;
  } {
    return {
      totalWindows: this.windows.size,
      maxWindows: this.config.maxWindows,
      memoryUsage: this.estimateMemoryUsage(),
    };
  }

  /**
   * Set window with LRU eviction
   */
  private setWindow(key: string, window: WindowState): void {
    if (this.windows.size >= this.config.maxWindows && !this.windows.has(key)) {
      this.evictLRU();
    }

    this.windows.set(key, window);
    
    const index = this.lruKeys.indexOf(key);
    if (index > -1) {
      this.lruKeys.splice(index, 1);
    }
    this.lruKeys.push(key);
  }

  /**
   * Evict least recently used window
   */
  private evictLRU(): void {
    if (this.lruKeys.length === 0) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [key, window] of this.windows.entries()) {
        if (window.lastAccess < oldestTime) {
          oldestTime = window.lastAccess;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.windows.delete(oldestKey);
      }
    } else {
      const keyToEvict = this.lruKeys.shift();
      if (keyToEvict) {
        this.windows.delete(keyToEvict);
      }
    }
  }

  /**
   * Estimate memory usage
   */
  private estimateMemoryUsage(): number {
    let total = 0;
    for (const window of this.windows.values()) {
      // Key (~50) + array overhead (~50) + timestamps (8 bytes each) + lastAccess (8)
      total += 50 + 50 + (window.requests.length * 8) + 8;
    }
    return total;
  }
}
