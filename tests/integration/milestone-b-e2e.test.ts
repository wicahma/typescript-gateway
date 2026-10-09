import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer as createHttpServer } from 'http';
import { AddressInfo } from 'net';
import { Gateway } from '../../src/index.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('milestone B end-to-end (security headers + admin control plane)', () => {
  let gateway: Gateway;
  let port: number;
  let upstream: ReturnType<typeof createHttpServer>;
  let upstreamPort: number;
  let configPath: string;
  let shadowed = 0;

  beforeAll(async () => {
    upstream = createHttpServer((req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        server: 'nginx',
        'x-powered-by': 'express',
      });
      res.end(JSON.stringify({ upstream: 'ok' }));
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    upstreamPort = (upstream.address() as AddressInfo).port;

    const config = {
      version: '1.0.0',
      environment: 'development',
      server: { port: 4012, host: '127.0.0.1' },
      securityHeaders: { enabled: true, stripServer: true, hsts: 'max-age=31536000' },
      admin: { enabled: true, basePath: '/__admin', requireAuth: false },
      routes: [{ method: 'GET', path: '/api/*', priority: 0 }],
      upstreams: [
        {
          id: 'backend',
          protocol: 'http',
          host: '127.0.0.1',
          port: upstreamPort,
          basePath: '',
          poolSize: 10,
          timeout: 30000,
          healthCheck: {
            enabled: false,
            interval: 30000,
            timeout: 5000,
            path: '/health',
            expectedStatus: 200,
          },
        },
      ],
      plugins: [],
      performance: {
        workerCount: 0,
        contextPoolSize: 100,
        bufferPoolSize: 100,
        responsePoolSize: 100,
        enablePooling: true,
      },
    };
    configPath = join(tmpdir(), `tsgate-milestoneb-${Date.now()}.json`);
    writeFileSync(configPath, JSON.stringify(config));

    gateway = new Gateway(configPath);
    await gateway.start();
    port = (gateway.getServer()!.getServer().address() as AddressInfo).port;
    void shadowed;
  }, 20000);

  afterAll(async () => {
    await gateway.stop();
    upstream.close();
    try {
      unlinkSync(configPath);
    } catch {
      void 0;
    }
  });

  it('adds security headers and strips server banners on proxied responses', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/data`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect(res.headers.get('server')).toBeNull();
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('exposes admin state as JSON', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/__admin/state`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.uptime).toBe('number');
    expect(Array.isArray(body.policies)).toBe(true);
    expect(body.policies).toContain('security-headers');
  });
});
