import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer as createHttpServer } from 'http';
import { AddressInfo } from 'net';
import { generateApiKey } from '../../src/identity/api-key-crypto.js';
import { Gateway } from '../../src/index.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('M3 API key engine end-to-end (in-process gateway)', () => {
  let gateway: Gateway;
  let port: number;
  let upstream: ReturnType<typeof createHttpServer>;
  let upstreamPort: number;
  let configPath: string;
  const goodKey = generateApiKey('live');
  const otherKey = generateApiKey('live');

  beforeAll(async () => {
    upstream = createHttpServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ upstream: 'ok', auth: req.headers['x-api-key'] ?? null }));
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    upstreamPort = (upstream.address() as AddressInfo).port;

    const config = {
      version: '1.0.0',
      environment: 'development',
      server: { port: 3999, host: '127.0.0.1' },
      apiKeys: {
        enabled: true,
        publicRoutes: ['/', '/health', '/metrics'],
        consumers: [
          { consumerId: 'cust-pro', plan: 'pro', rateLimit: 3, keys: [{ key: goodKey }] },
          { consumerId: 'cust-free', plan: 'free', rateLimit: 1000, keys: [{ key: otherKey }] },
        ],
      },
      routes: [{ method: 'GET', path: '/api/*', priority: 0 }],
      upstreams: [{
        id: 'backend', protocol: 'http', host: '127.0.0.1', port: upstreamPort,
        basePath: '', poolSize: 10, timeout: 30000,
        healthCheck: { enabled: false, interval: 30000, timeout: 5000, path: '/health', expectedStatus: 200 },
      }],
      plugins: [],
      performance: { workerCount: 0, contextPoolSize: 100, bufferPoolSize: 100, responsePoolSize: 100, enablePooling: true },
    };
    configPath = join(tmpdir(), `tsgate-m3-${Date.now()}.json`);
    writeFileSync(configPath, JSON.stringify(config));

    gateway = new Gateway(configPath);
    await gateway.start();
    const server = gateway.getServer();
    port = (server!.getServer().address() as AddressInfo).port;
    if (!port || port === 3999 && false) port = 3999;
  }, 20000);

  afterAll(async () => {
    await gateway.stop();
    upstream.close();
    try { unlinkSync(configPath); } catch {}
  });

  it('rejects missing key with 401 problem+json', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/data`);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const problem = await res.json();
    expect(problem.title).toBe('Unauthorized');
    expect(problem.type).toContain('unauthorized');
  });

  it('rejects malformed key with format error', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/data`, { headers: { 'x-api-key': 'not-a-tsgk-key' } });
    expect(res.status).toBe(401);
    expect((await res.json()).detail).toBe('Invalid API key format');
  });

  it('rejects tampered checksum', async () => {
    const tampered = goodKey.slice(0, -1) + (goodKey.endsWith('0') ? '1' : '0');
    const res = await fetch(`http://127.0.0.1:${port}/api/data`, { headers: { 'x-api-key': tampered } });
    expect(res.status).toBe(401);
    expect((await res.json()).detail).toBe('API key checksum mismatch');
  });

  it('forwards valid-key request with identity upstream', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/data`, { headers: { 'x-api-key': goodKey } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ upstream: 'ok', auth: goodKey });
  });

  it('accepts Bearer fallback', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/data`, { headers: { authorization: `Bearer ${goodKey}` } });
    expect(res.status).toBe(200);
  });

  it('rate-limits per consumer bucket (429 with Retry-After)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`http://127.0.0.1:${port}/api/data`, { headers: { 'x-api-key': goodKey } });
      statuses.push(r.status);
      if (r.status === 429) {
        expect(r.headers.get('retry-after')).toBeTruthy();
        expect(r.headers.get('x-ratelimit-remaining')).toBe('0');
      }
    }
    expect(statuses[0]).toBe(200);
    expect(statuses).toContain(429);
    expect(statuses[statuses.length - 1]).toBe(429);
  });

  it('bypasses public routes without key', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
  });
});
