/**
 * B6 regression: GET /metrics honors monitoring.metrics.enabled and
 * monitoring.export.prometheus.path. When enabled, the base snapshot is
 * enriched with 'advanced' (AdvancedMetrics route/upstream summaries);
 * when the prometheus path is set, that path serves the snapshot and the
 * default /metrics stays available. When disabled, no 'advanced' key.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { Gateway } from '../../src/index.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('B6 /metrics serves AdvancedMetrics honoring monitoring config (in-process)', () => {
  let gateway: Gateway;
  let port: number;
  let upstream: ReturnType<typeof createServer>;
  let configPath: string;

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;

    const config = {
      version: '1.0.0',
      environment: 'development',
      server: { port: 4001, host: '127.0.0.1' },
      routes: [{ method: 'GET', path: '/api/*', priority: 0 }],
      upstreams: [{
        id: 'backend', protocol: 'http', host: '127.0.0.1', port: upstreamPort,
        basePath: '', poolSize: 10, timeout: 30000,
        healthCheck: { enabled: false, interval: 30000, timeout: 5000, path: '/health', expectedStatus: 200 },
      }],
      monitoring: {
        metrics: { enabled: true },
        export: { prometheus: { path: '/custom-metrics', port: 0 } },
      },
      performance: { workerCount: 0, contextPoolSize: 100, bufferPoolSize: 100, responsePoolSize: 100, enablePooling: true },
    };
    configPath = join(tmpdir(), `tsgate-b6-${Date.now()}.json`);
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

  it('serves advanced metrics on the configured prometheus path after a proxied request', async () => {
    const proxied = await fetch(`http://127.0.0.1:${port}/api/thing`);
    expect(proxied.status).toBe(200);

    const res = await fetch(`http://127.0.0.1:${port}/custom-metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body).toHaveProperty('advanced');
    expect(Array.isArray(body.advanced.routes)).toBe(true);
    expect(Array.isArray(body.advanced.upstreams)).toBe(true);
    // The proxied route is reflected in route metrics.
    expect(body.advanced.routes.some((r: { route: string }) => r.route.includes('/api/'))).toBe(true);
  }, 20000);

  it('keeps the default /metrics endpoint serving the base snapshot', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('advanced');
  }, 20000);
});

describe('B6 metrics disabled -> no advanced key (in-process)', () => {
  let gateway: Gateway;
  let port: number;
  let upstream: ReturnType<typeof createServer>;
  let configPath: string;

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;

    const config = {
      version: '1.0.0',
      environment: 'development',
      server: { port: 4002, host: '127.0.0.1' },
      routes: [{ method: 'GET', path: '/api/*', priority: 0 }],
      upstreams: [{
        id: 'backend', protocol: 'http', host: '127.0.0.1', port: upstreamPort,
        basePath: '', poolSize: 10, timeout: 30000,
        healthCheck: { enabled: false, interval: 30000, timeout: 5000, path: '/health', expectedStatus: 200 },
      }],
      monitoring: { metrics: { enabled: false } },
      performance: { workerCount: 0, contextPoolSize: 100, bufferPoolSize: 100, responsePoolSize: 100, enablePooling: true },
    };
    configPath = join(tmpdir(), `tsgate-b6-disabled-${Date.now()}.json`);
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

  it('serves the base snapshot without an advanced section', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty('advanced');
  }, 20000);
});