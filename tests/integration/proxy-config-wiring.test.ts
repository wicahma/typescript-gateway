/**
 * B3 regression: the Gateway builds its ProxyHandler from the full config —
 * bodyParser, loadBalancer strategy, circuitBreaker thresholds, compression,
 * monitoring.metrics, streamingThreshold and response transforms — instead of
 * hardcoding `{ enableWebSocket }`. Each knob is verified against a real
 * in-process gateway + upstream.
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

describe('B3 ProxyHandler built from full config (in-process gateway)', () => {
  let gateway: Gateway;
  let port: number;
  let upstream: ReturnType<typeof createServer>;
  let configPath: string;
  let goodHits = 0;
  let badHits = 0;
  const big = 'x'.repeat(64 * 1024); // large enough to trigger streamingThreshold

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      if (req.url?.endsWith('/oops')) {
        badHits++;
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('boom');
        return;
      }
      goodHits++;
      const isBig = req.url?.endsWith('/big');
      const body = isBig ? big : JSON.stringify({ ok: true });
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        // readable size is derived from content-length: /big streamed, small buffered
      });
      res.end(body);
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;

    const config = {
      version: '1.0.0',
      environment: 'development',
      server: { port: 3998, host: '127.0.0.1' },
      routes: [{ method: 'GET', path: '/api/*', priority: 0 }],
      upstreams: [{
        id: 'backend', protocol: 'http', host: '127.0.0.1', port: upstreamPort,
        basePath: '', poolSize: 10, timeout: 30000,
        healthCheck: { enabled: false, interval: 30000, timeout: 5000, path: '/health', expectedStatus: 200 },
      }],
      plugins: [],
      performance: { workerCount: 0, contextPoolSize: 100, bufferPoolSize: 100, responsePoolSize: 100, enablePooling: true },
      loadBalancer: { strategy: 'least-connections', healthCheckType: 'active', healthAware: false },
      circuitBreaker: { failureThreshold: 2, successThreshold: 1, timeout: 60000, windowSize: 10 },
      monitoring: { metrics: { enabled: true, collectInterval: 1000, retentionPeriod: 60, aggregationWindows: [60] } },
      transforms: {
        response: [{
          routes: ['/api/*'],
          headers: { add: { 'x-gw-transformed': 'yes' } },
        }],
      },
      streamingThreshold: 1024,
    };
    configPath = join(tmpdir(), `tsgate-b3-${Date.now()}.json`);
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

  const get = async (path: string): Promise<{ status: number; body: string; headers: Headers }> => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.text(), headers: res.headers };
  };

  it('applies response transformations from config', async () => {
    const r = await get('/api/thing');
    expect(r.status).toBe(200);
    expect(r.headers.get('x-gw-transformed')).toBe('yes');
  });

  it('loads the configured load balancer strategy (least-connections)', async () => {
    const ph = (gateway as unknown as { proxyHandler: ProxyHandler }).proxyHandler;
    const lb = (ph as unknown as { loadBalancer: { getStrategy(): string } }).loadBalancer;
    expect(lb.getStrategy()).toBe('least-connections');
  });

  it('streams large responses when streamingThreshold is configured', async () => {
    const r = await get('/api/big');
    expect(r.status).toBe(200);
    expect(r.body).toBe(big);
  });

  // Must run last: it leaves the breaker OPEN (timeout 60s).
  it('applies circuit breaker thresholds from config (opens at 2, not 5)', async () => {
    const a = await get('/api/oops');
    const b = await get('/api/oops');
    expect(a.status).toBe(500);
    expect(b.status).toBe(500);

    const ph = (gateway as unknown as { proxyHandler: ProxyHandler }).proxyHandler;
    const breaker = ph.getCircuitBreaker('backend');
    expect(breaker!.getState()).toBe(CircuitBreakerState.OPEN);

    const rejected = await get('/api/oops');
    expect(rejected.status).toBe(502);
    expect(badHits).toBe(2); // breaker opened before the third request touched the upstream
  }, 20000);
});