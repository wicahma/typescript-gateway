import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer as createHttpServer } from 'http';
import { AddressInfo } from 'net';
import { Gateway } from '../../src/index.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwx';

describe('feature pack end-to-end (CORS + trace + idempotency + masking)', () => {
  let gateway: Gateway;
  let port: number;
  let upstream: ReturnType<typeof createHttpServer>;
  let upstreamPort: number;
  let configPath: string;

  beforeAll(async () => {
    upstream = createHttpServer((req, res) => {
      if (req.method === 'POST') {
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 7, secretToken: JWT }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ upstream: 'ok' }));
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    upstreamPort = (upstream.address() as AddressInfo).port;

    const config = {
      version: '1.0.0',
      environment: 'development',
      server: { port: 4011, host: '127.0.0.1' },
      cors: {
        enabled: true,
        allowOrigins: ['https://app.example.com'],
        allowMethods: ['GET', 'POST'],
      },
      traceContext: { enabled: true },
      idempotency: { enabled: true },
      secretMask: { enabled: true },
      routes: [
        { method: 'GET', path: '/api/*', priority: 0 },
        { method: 'POST', path: '/api/*', priority: 0 },
      ],
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
    configPath = join(tmpdir(), `tsgate-featurepack-${Date.now()}.json`);
    writeFileSync(configPath, JSON.stringify(config));

    gateway = new Gateway(configPath);
    await gateway.start();
    port = (gateway.getServer()!.getServer().address() as AddressInfo).port;
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

  it('answers a CORS preflight with 204 and allow-origin', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/data`, {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example.com', 'access-control-request-method': 'POST' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('rejects a disallowed origin preflight with 403', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/data`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(res.status).toBe(403);
  });

  it('echoes a W3C traceparent on proxied requests', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/data`);
    expect(res.status).toBe(200);
    expect(res.headers.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('masks secrets in the upstream response body', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/data`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).toContain('[REDACTED]');
    expect(text).not.toContain(JWT);
    expect(res.headers.get('x-secret-masked')).toBe('true');
  });

  it('replays the stored response for a repeated idempotency key', async () => {
    const first = await fetch(`http://127.0.0.1:${port}/api/pay`, {
      method: 'POST',
      headers: { 'idempotency-key': 'key-abc' },
      body: '{"amount":10}',
    });
    expect(first.status).toBe(201);
    const second = await fetch(`http://127.0.0.1:${port}/api/pay`, {
      method: 'POST',
      headers: { 'idempotency-key': 'key-abc' },
      body: '{"amount":10}',
    });
    expect(second.status).toBe(201);
    expect(second.headers.get('idempotent-replay')).toBe('true');
  });
});
