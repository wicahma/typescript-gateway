import { describe, it, expect } from 'vitest';
import { Router } from '../../src/core/router';
import { HttpMethod, RequestContext } from '../../src/types/core';

describe('Router', () => {
  it('should register and match static routes', () => {
    const router = new Router();
    const handler = async () => {};

    router.register('GET', '/test', handler);
    const match = router.match('GET', '/test');

    expect(match).toBeDefined();
    expect(match?.handler).toBe(handler);
    expect(match?.params).toEqual({});
  });

  it('should match dynamic routes with parameters', () => {
    const router = new Router();
    const handler = async () => {};

    router.register('GET', '/users/:id', handler);
    const match = router.match('GET', '/users/123');

    expect(match).toBeDefined();
    expect(match?.handler).toBe(handler);
    expect(match?.params).toEqual({ id: '123' });
  });

  it('should return null for unmatched routes', () => {
    const router = new Router();
    const match = router.match('GET', '/nonexistent');

    expect(match).toBeNull();
  });

  it('should prioritize exact matches over dynamic routes', () => {
    const router = new Router();
    const staticHandler = async () => {};
    const dynamicHandler = async () => {};

    router.register('GET', '/users/:id', dynamicHandler);
    router.register('GET', '/users/me', staticHandler);

    const match = router.match('GET', '/users/me');

    expect(match?.handler).toBe(staticHandler);
  });

  it('should handle multiple parameters', () => {
    const router = new Router();
    const handler = async () => {};

    router.register('GET', '/users/:userId/posts/:postId', handler);
    const match = router.match('GET', '/users/123/posts/456');

    expect(match?.params).toEqual({
      userId: '123',
      postId: '456'
    });
  });

  it('should clear all routes', () => {
    const router = new Router();
    router.register('GET', '/test', async () => {});
    router.clear();

    const match = router.match('GET', '/test');
    expect(match).toBeNull();
  });
});
