/**
 * A5 regression: upstream 5xx responses count as circuit-breaker failures.
 * Default breaker config (failureThreshold 5, windowSize 10) must OPEN after
 * 5 consecutive 500s — previously a full window was required and 5xx never
 * counted at all (only thrown errors did).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { Gateway } from '../../src/index.js';
import { ProxyHandler } from '../../src/core/proxy-handler.js';
import { CircuitBreakerState } from '../../src/types/core.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('A5 circuit breaker counts upstream 5xx (in-process gateway)', () => {
  let gateway: Gateway;
  let port: number;
  let upstream: ReturnType<typeof createServer>;
  let configPath: string;
  let upstreamHits = 0;

  beforeAll(async () => {
    upstream = createServer((_req, res) => {
      upstreamHits++;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('upstream exploded');
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;

    const config = {
      version: '1.0.0',
      environment: 'development',
      server: { port: 3997, host: '127.0.0.1' },
      routes: [{ method: 'GET', path: '/api/*', priority: 0 }],
      upstreams: [{
        id: 'backend', protocol: 'http', host: '127.0.0.1', port: upstreamPort,
        basePath: '', poolSize: 10, timeout: 30000,
        healthCheck: { enabled: false, interval: 30000, timeout: 5000, path: '/health', expectedStatus: 200 },
      }],
      plugins: [],
      performance: { workerCount: 0, contextPoolSize: 100, bufferPoolSize: 100, responsePoolSize: 100, enablePooling: true },
    };
    configPath = join(tmpdir(), `tsgate-a5-${Date.now()}.json`);
    writeFileSync(configPath, JSON.stringify(config));

    gateway = new Gateway(configPath);
    await gateway.start();
    port = (gateway.getServer()!.getServer().address() as AddressInfo).port;
  }, 20000);

  afterAll(async () => {
    await gateway.stop();
    upstream.close();
    try { unlinkSync(configPath); } catch {}
  });

  const get = async (): Promise<{ status: number; body: string }> => {
    const res = await fetch(`http://127.0.0.1:${port}/api/down`);
    return { status: res.status, body: await res.text() };
  };

  it('forwards 5xx responses but opens the breaker after 5 consecutive failures', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await get();
      statuses.push(r.status);
      expect(r.body).toBe('upstream exploded'); // 5xx is still forwarded
    }
    expect(statuses).toEqual([500, 500, 500, 500, 500]);
    expect(upstreamHits).toBe(5);

    const ph = (gateway as unknown as { proxyHandler: ProxyHandler }).proxyHandler;
    const breaker = ph.getCircuitBreaker('backend');
    expect(breaker).toBeDefined();
    expect(breaker!.getState()).toBe(CircuitBreakerState.OPEN);

    // Open breaker rejects before the request reaches the upstream.
    const rejected = await get();
    expect(rejected.status).toBe(502);
    expect(upstreamHits).toBe(5);
  }, 20000);
});
