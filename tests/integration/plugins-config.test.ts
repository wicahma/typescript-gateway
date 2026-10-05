/**
 * B5 regression: the Gateway loads enabled plugins from config.plugins[]
 * (builtin registry by name), invoking their lifecycle hooks on every request.
 * Observable effect: header-transformer (preHandler) adds a request header
 * that the upstream echoes back. Disabled and unknown entries are skipped
 * without failing startup.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { Gateway } from '../../src/index.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('B5 config.plugins[] array loaded by the Gateway (in-process)', () => {
  let gateway: Gateway;
  let port: number;
  let upstream: ReturnType<typeof createServer>;
  let configPath: string;
  let upstreamHits = 0;

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      upstreamHits++;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(String(req.headers['x-gw-plugin'] ?? 'MISSING'));
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;

    const config = {
      version: '1.0.0',
      environment: 'development',
      server: { port: 4000, host: '127.0.0.1' },
      routes: [{ method: 'GET', path: '/api/*', priority: 0 }],
      upstreams: [{
        id: 'backend', protocol: 'http', host: '127.0.0.1', port: upstreamPort,
        basePath: '', poolSize: 10, timeout: 30000,
        healthCheck: { enabled: false, interval: 30000, timeout: 5000, path: '/health', expectedStatus: 200 },
      }],
      // Previously ignored: only CLI plugins.dir was read.
      plugins: [
        {
          name: 'header-transformer',
          enabled: true,
          settings: {
            rules: [{ name: 'x-gw-plugin', action: 'add', value: 'from-config-plugins', applyToRequest: true }],
          },
        },
        { name: 'response-time', enabled: false, settings: {} },
        { name: 'does-not-exist', enabled: true, settings: {} },
      ],
      performance: { workerCount: 0, contextPoolSize: 100, bufferPoolSize: 100, responsePoolSize: 100, enablePooling: true },
    };
    configPath = join(tmpdir(), `tsgate-b5-${Date.now()}.json`);
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

  it('invokes the enabled builtin plugin (header injected upstream)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/thing`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('from-config-plugins');
    expect(upstreamHits).toBe(1);
  }, 20000);
});