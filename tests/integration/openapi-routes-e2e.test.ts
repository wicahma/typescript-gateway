import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer as createHttpServer } from 'http';
import { AddressInfo } from 'net';
import { Gateway } from '../../src/index.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('OpenAPI spec as routing source (e2e)', () => {
  let gateway: Gateway;
  let port: number;
  let upstream: ReturnType<typeof createHttpServer>;
  let upstreamPort: number;
  let configPath: string;

  beforeAll(async () => {
    upstream = createHttpServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ path: req.url }));
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    upstreamPort = (upstream.address() as AddressInfo).port;

    const config = {
      version: '1.0.0',
      environment: 'development',
      server: { port: 4013, host: '127.0.0.1' },
      openapi: {
        enabled: true,
        spec: {
          openapi: '3.1.0',
          info: { title: 'x', version: '1.0.0' },
          paths: {
            '/api/users/{id}': { get: { operationId: 'getUser' } },
          },
        },
      },
      routes: [],
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
    configPath = join(tmpdir(), `tsgate-openapi-${Date.now()}.json`);
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

  it('proxies a path declared only in the OpenAPI spec', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/users/42`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe('/api/users/42');
  });

  it('registers the {id} route from the spec', () => {
    const routes = gateway.getRouter().getRoutes();
    expect(routes.some(r => r.path === '/api/users/:id')).toBe(true);
  });
});
