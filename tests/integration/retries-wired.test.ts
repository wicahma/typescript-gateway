/**
 * B4 regression: the Gateway wires config.retries into the proxy request path.
 * Idempotent requests are retried by RetryManager on retryable network errors
 * (ECONNRESET here); non-retryable methods (POST) stay single-shot.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { Gateway } from '../../src/index.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('B4 retries wired into proxy request path (in-process gateway)', () => {
  let gateway: Gateway;
  let port: number;
  let upstream: ReturnType<typeof createServer>;
  let configPath: string;
  let flakyHits = 0;
  let postHits = 0;

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      if (req.method === 'POST' && req.url?.endsWith('/fail')) {
        postHits++;
        res.destroy(); // always resets; POST must not be retried
        return;
      }
      flakyHits++;
      if (flakyHits <= 2) {
        res.destroy(); // connection reset -> retryable
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('recovered');
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;

    const config = {
      version: '1.0.0',
      environment: 'development',
      server: { port: 3999, host: '127.0.0.1' },
      routes: [
        { method: 'GET', path: '/api/*', priority: 0 },
        { method: 'POST', path: '/api/*', priority: 0 },
      ],
      upstreams: [{
        id: 'backend', protocol: 'http', host: '127.0.0.1', port: upstreamPort,
        basePath: '', poolSize: 10, timeout: 30000,
        healthCheck: { enabled: false, interval: 30000, timeout: 5000, path: '/health', expectedStatus: 200 },
      }],
      plugins: [],
      performance: { workerCount: 0, contextPoolSize: 100, bufferPoolSize: 100, responsePoolSize: 100, enablePooling: true },
      retries: {
        maxAttempts: 3,
        initialDelay: 10,
        maxDelay: 50,
        backoffMultiplier: 2,
        jitter: false,
        retryableStatuses: [502, 503, 504],
        retryableMethods: ['GET'],
        timeout: 5000,
      },
    };
    configPath = join(tmpdir(), `tsgate-b4-${Date.now()}.json`);
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

  it('retries GET until the upstream recovers (3 attempts)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/flaky`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('recovered');
    expect(flakyHits).toBe(3);
  }, 20000);

  it('does not retry non-retryable methods (POST is single-shot)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/fail`, { method: 'POST' });
    expect(res.status).toBe(502);
    expect(postHits).toBe(1);
  }, 20000);
});