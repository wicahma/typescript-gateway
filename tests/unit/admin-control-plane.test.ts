import { describe, it, expect } from 'vitest';
import { Router } from '../../src/core/router.js';
import { AdminControlPlane, AdminDeps } from '../../src/admin/control-plane.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function ctx(method = 'GET', path = '/__admin/state', user?: unknown) {
  const c = pool.acquire();
  const captured: { body?: string; status?: number } = {};
  c.requestId = 'req-admin';
  c.method = method as never;
  c.path = path;
  c.headers = {};
  c.state = user ? { user } : {};
  c.responded = false;
  c.res = {
    statusCode: 0,
    headersSent: false,
    body: undefined as string | undefined,
    writeHead(status: number) {
      this.statusCode = status;
      return this;
    },
    setHeader() {
      return this;
    },
    getHeader() {
      return undefined;
    },
    write(chunk: string) {
      this.body = chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk !== undefined) this.body = chunk;
    },
    _captured: captured,
  } as never;
  return c;
}

function deps(): AdminDeps {
  return {
    getUptime: () => 42,
    getBreakers: () => ({ backend: 'CLOSED' }),
    getCacheStats: () => ({ hits: 3, misses: 1, entries: 2 }),
    getLoadShed: () => ({ limit: 100, inflight: 2 }),
    purgeCache: (re: RegExp) => (re.test('GET|/api') ? 5 : 0),
    getPolicies: () => ['load-shed', 'cors', 'api-key-auth'],
  };
}

describe('AdminControlPlane', () => {
  it('reports state as JSON when authenticated', async () => {
    const router = new Router();
    const plane = new AdminControlPlane(deps(), { requireAuth: true });
    plane.register(router);
    const match = router.match('GET', '/__admin/state');
    expect(match).not.toBeNull();
    const c = ctx('GET', '/__admin/state', { sub: 'admin', data: { plan: 'admin' } });
    await match!.handler(c);
    const body = JSON.parse((c.res as unknown as { body: string }).body);
    expect(body.uptime).toBe(42);
    expect(body.breakers).toEqual({ backend: 'CLOSED' });
    expect(body.cache).toEqual({ hits: 3, misses: 1, entries: 2 });
    expect(body.loadShed).toEqual({ limit: 100, inflight: 2 });
    expect(body.policies).toContain('cors');
  });

  it('rejects state without an authenticated user', async () => {
    const router = new Router();
    const plane = new AdminControlPlane(deps(), { requireAuth: true });
    plane.register(router);
    const match = router.match('GET', '/__admin/state');
    const c = ctx('GET', '/__admin/state');
    await match!.handler(c);
    expect((c.res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  it('purges the cache and returns the count', async () => {
    const router = new Router();
    const plane = new AdminControlPlane(deps(), { requireAuth: true });
    plane.register(router);
    const match = router.match('POST', '/__admin/cache/purge');
    expect(match).not.toBeNull();
    const c = ctx('POST', '/__admin/cache/purge', { sub: 'admin', data: { plan: 'admin' } });
    (c as unknown as { body: Buffer | null }).body = Buffer.from(
      JSON.stringify({ pattern: 'GET\\|/api' })
    );
    await match!.handler(c);
    const body = JSON.parse((c.res as unknown as { body: string }).body);
    expect(body.purged).toBe(5);
  });

  it('does not require auth when requireAuth is false', async () => {
    const router = new Router();
    const plane = new AdminControlPlane(deps(), { requireAuth: false });
    plane.register(router);
    const match = router.match('GET', '/__admin/state');
    const c = ctx('GET', '/__admin/state');
    await match!.handler(c);
    expect((c.res as unknown as { statusCode: number }).statusCode).toBe(200);
  });

  it('uses a custom base path', () => {
    const router = new Router();
    const plane = new AdminControlPlane(deps(), { basePath: '/__ops' });
    plane.register(router);
    expect(router.match('GET', '/__ops/state')).not.toBeNull();
  });
});
