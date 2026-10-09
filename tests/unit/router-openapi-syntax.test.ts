import { describe, it, expect } from 'vitest';
import { Router } from '../../src/core/router.js';

async function noop(): Promise<void> {
  void 0;
}

describe('Router OpenAPI-style path syntax', () => {
  it('matches {id} param syntax', () => {
    const router = new Router();
    router.register('GET', '/users/{id}', noop);
    const match = router.match('GET', '/users/42');
    expect(match).not.toBeNull();
    expect(match!.params['id']).toBe('42');
  });

  it('matches multiple {params}', () => {
    const router = new Router();
    router.register('GET', '/orgs/{org}/repos/{repo}', noop);
    const match = router.match('GET', '/orgs/acme/repos/gateway');
    expect(match).not.toBeNull();
    expect(match!.params['org']).toBe('acme');
    expect(match!.params['repo']).toBe('gateway');
  });

  it('still matches :param syntax', () => {
    const router = new Router();
    router.register('GET', '/orders/:orderId', noop);
    const match = router.match('GET', '/orders/9');
    expect(match!.params['orderId']).toBe('9');
  });

  it('supports a wildcard after {param}', () => {
    const router = new Router();
    router.register('GET', '/files/{path}/*', noop);
    expect(router.match('GET', '/files/a/b/c')).not.toBeNull();
  });

  it('records the route with its normalized path', () => {
    const router = new Router();
    router.register('GET', '/things/{thingId}', noop);
    const routes = router.getRoutes();
    const route = routes.find((r) => r.method === 'GET' && r.path.includes('thingId'));
    expect(route).toBeDefined();
  });

  it('does not match a different static path', () => {
    const router = new Router();
    router.register('GET', '/users/{id}', noop);
    expect(router.match('GET', '/accounts/42')).toBeNull();
  });
});
