import { describe, it, expect } from 'vitest';
import { Router } from '../../src/core/router.js';

async function noop(): Promise<void> {
  void 0;
}

describe('Router regex-group path params', () => {
  it('matches a digit-only param and extracts it', () => {
    const router = new Router();
    router.register('GET', '/orders/:orderId(\\d+)', noop);
    const match = router.match('GET', '/orders/123');
    expect(match).not.toBeNull();
    expect(match!.params['orderId']).toBe('123');
  });

  it('rejects a segment that fails the regex', () => {
    const router = new Router();
    router.register('GET', '/orders/:orderId(\\d+)', noop);
    expect(router.match('GET', '/orders/abc')).toBeNull();
  });

  it('does not match an extra segment', () => {
    const router = new Router();
    router.register('GET', '/orders/:orderId(\\d+)', noop);
    expect(router.match('GET', '/orders/123/extra')).toBeNull();
  });

  it('supports an alternation regex', () => {
    const router = new Router();
    router.register('GET', '/reports/:kind(daily|weekly)', noop);
    expect(router.match('GET', '/reports/daily')!.params['kind']).toBe('daily');
    expect(router.match('GET', '/reports/weekly')!.params['kind']).toBe('weekly');
    expect(router.match('GET', '/reports/monthly')).toBeNull();
  });

  it('prefers a static segment over a regex param', () => {
    const router = new Router();
    router.register('GET', '/users/:id(\\d+)', noop);
    router.register('GET', '/users/me', noop);
    const match = router.match('GET', '/users/me');
    expect(match!.params).toEqual({});
  });

  it('matches a regex param alongside a plain param', () => {
    const router = new Router();
    router.register('GET', '/orgs/:org/repos/:repoId(\\d+)', noop);
    const match = router.match('GET', '/orgs/acme/repos/42');
    expect(match!.params['org']).toBe('acme');
    expect(match!.params['repoId']).toBe('42');
  });

  it('exposes the regex param name without the pattern in route metadata', () => {
    const router = new Router();
    router.register('GET', '/items/:id(\\d+)', noop);
    const route = router.getRoutes().find(r => r.path.includes('items'));
    expect(route).toBeDefined();
    const match = router.match('GET', '/items/7');
    expect(match!.params['id']).toBe('7');
  });
});
