import { describe, it, expect } from 'vitest';
import { ObjectPool } from '../../src/utils/pool';

class TestPoolable {
  value = 0;

  reset() {
    this.value = 0;
  }
}

describe('ObjectPool', () => {
  it('should create pool with specified size', () => {
    const pool = new ObjectPool(() => new TestPoolable(), 10);
    const stats = pool.getStats();

    expect(stats.size).toBe(10);
    expect(stats.available).toBe(10);
  });

  it('should acquire and release objects', () => {
    const pool = new ObjectPool(() => new TestPoolable(), 5);

    const obj = pool.acquire();
    expect(obj).toBeInstanceOf(TestPoolable);

    let stats = pool.getStats();
    expect(stats.available).toBe(4);
    expect(stats.inUse).toBe(1);
    expect(stats.hits).toBe(1);

    pool.release(obj);
    stats = pool.getStats();
    expect(stats.available).toBe(5);
    expect(stats.inUse).toBe(0);
  });

  it('should reset objects when released', () => {
    const pool = new ObjectPool(() => new TestPoolable(), 5);

    const obj = pool.acquire();
    obj.value = 42;

    pool.release(obj);

    const obj2 = pool.acquire();
    expect(obj2.value).toBe(0); // Should be reset
  });

  it('should handle pool overflow', () => {
    const pool = new ObjectPool(() => new TestPoolable(), 2);

    const obj1 = pool.acquire();
    const obj2 = pool.acquire();
    const obj3 = pool.acquire(); // Overflow

    const stats = pool.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.allocations).toBe(3);
  });

  it('should clear and reset pool', () => {
    const pool = new ObjectPool(() => new TestPoolable(), 5);

    pool.acquire();
    pool.acquire();

    pool.clear();

    const stats = pool.getStats();
    expect(stats.available).toBe(5);
    expect(stats.inUse).toBe(0);
  });
});
