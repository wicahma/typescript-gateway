import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer as createHttpServer } from 'http';
import { AddressInfo } from 'net';
import { generateApiKey } from '../../src/identity/api-key-crypto.js';
import { Gateway } from '../../src/index.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHmac, createHash } from 'node:crypto';

const SHARED_SECRET = 'integration-hmac-secret-zzz';

describe('M4 upstream credential injection end-to-end', () => {
  let gateway: Gateway;
  let port: number;
  let upstream: ReturnType<typeof createHttpServer>;
  let upstreamPort: number;
  let configPath: string;
  const goodKey = generateApiKey('live');
  const received: Array<Record<string, string>> = [];

  beforeAll(async () => {
    upstream = createHttpServer((req, res) => {
      received.push(req.headers as Record<string, string>);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ upstream: 'ok' }));
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    upstreamPort = (upstream.address() as AddressInfo).port;

    const config = {
      version: '1.0.0',
      environment: 'development',
      server: { port: 3998, host: '127.0.0.1' },
      apiKeys: {
        enabled: true,
        publicRoutes: ['/', '/health', '/metrics'],
        consumers: [{ consumerId: 'cust-pro', plan: 'pro', rateLimit: 1000, keys: [{ key: goodKey }] }],
      },
      upstreamCredentials: {
        enabled: true,
        credentials: [{
          name: 'backend',
          headers: { authorization: 'Bearer internal-gateway-secret', 'x-internal-service': 'gateway' },
          hmac: { secret: SHARED_SECRET, keyId: 'bk-1' },
        }],
        injection: { credentialName: 'backend' },
        signing: { credentialName: 'backend' },
      },
      routes: [{ method: 'POST', path: '/api/*', priority: 0 }],
      upstreams: [{
        id: 'backend', protocol: 'http', host: '127.0.0.1', port: upstreamPort,
        basePath: '', poolSize: 10, timeout: 30000,
        healthCheck: { enabled: false, interval: 30000, timeout: 5000, path: '/health', expectedStatus: 200 },
      }],
      plugins: [],
      performance: { workerCount: 0, contextPoolSize: 100, bufferPoolSize: 100, responsePoolSize: 100, enablePooling: true },
    };
    configPath = join(tmpdir(), `tsgate-m4-${Date.now()}.json`);
    writeFileSync(configPath, JSON.stringify(config));

    gateway = new Gateway(configPath);
    await gateway.start();
    const server = gateway.getServer();
    port = (server!.getServer().address() as AddressInfo).port;
  }, 20000);

  afterAll(async () => {
    await gateway.stop();
    upstream.close();
    try { unlinkSync(configPath); } catch {}
  });

  it('forwards with injected authorization + HMAC signature after valid API key', async () => {
    const body = '{"amount":500}';
    const res = await fetch(`http://127.0.0.1:${port}/api/charge`, {
      method: 'POST',
      headers: { 'x-api-key': goodKey, 'content-type': 'application/json' },
      body,
    });
    expect(res.status).toBe(200);

    const seen = received[received.length - 1];
    expect(seen['authorization']).toBe('Bearer internal-gateway-secret');
    expect(seen['x-internal-service']).toBe('gateway');
    expect(seen['x-signature']).toBeDefined();
    expect(seen['x-timestamp']).toMatch(/^\d+$/);
    expect(seen['x-key-id']).toBe('bk-1');

    const digest = createHash('sha256').update(body).digest('hex');
    const canonical = `POST\n/api/charge\n${seen['x-timestamp']}\n${digest}`;
    const expected = createHmac('sha256', SHARED_SECRET).update(canonical).digest('base64');
    expect(seen['x-signature']).toBe(expected);
  });

  it('strips the caller-supplied authorization header before forwarding', async () => {
    await fetch(`http://127.0.0.1:${port}/api/data`, {
      method: 'POST',
      headers: { 'x-api-key': goodKey, authorization: 'Bearer caller-attempt', cookie: 'session=leak' },
    });
    const seen = received[received.length - 1];
    expect(seen['authorization']).toBe('Bearer internal-gateway-secret');
    expect(seen['cookie']).toBeUndefined();
    expect(JSON.stringify(seen)).not.toContain('caller-attempt');
  });

  it('leaves public routes unmodified (no injection, no signing)', async () => {
    const before = received.length;
    await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: 'Bearer caller-keep' } });
    expect(received.length).toBe(before);
  });

  it('rejects unauthenticated callers with 401 before any injection', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/charge`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });
});
