import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import { UrlForwarder } from '../../src/core/url-forward';
import { HttpClientPool } from '../../src/core/http-client-pool';
import { UpstreamTarget } from '../../src/types/core';

const upstreams: http.Server[] = [];

function startUpstream(handler: http.RequestListener): Promise<UpstreamTarget> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('no address');
      upstreams.push(server);
      resolve({
        id: 'test-upstream',
        protocol: 'http',
        host: '127.0.0.1',
        port: address.port,
        basePath: '/api',
        poolSize: 5,
        timeout: 5000,
        healthCheck: { enabled: false, interval: 1000, path: '/', timeout: 1000, healthyThreshold: 1, unhealthyThreshold: 1 },
        healthy: true,
      } as UpstreamTarget);
    });
  });
}

afterEach(() => {
  for (const server of upstreams) server.close();
  upstreams.length = 0;
});

describe('UrlForwarder', () => {
  it('forwards a GET and returns upstream status, headers and body', async () => {
    const upstream = await startUpstream((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Upstream': 'yes' });
      res.end('hello');
    });
    const forwarder = new UrlForwarder(new HttpClientPool());

    const result = await forwarder.forward({
      method: 'GET',
      path: '/items',
      headers: {},
      upstream,
      timeout: 5000,
    });

    expect(result.statusCode).toBe(200);
    expect(result.headers['x-upstream']).toBe('yes');
    expect(result.body?.toString()).toBe('hello');
  });

  it('forwards a POST with body and upstream receives it', async () => {
    const upstream = await startUpstream((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(201);
        res.end(`echo:${Buffer.concat(chunks).toString()}`);
      });
    });
    const forwarder = new UrlForwarder(new HttpClientPool());

    const result = await forwarder.forward({
      method: 'POST',
      path: '/create',
      headers: { 'content-type': 'text/plain' },
      body: Buffer.from('payload'),
      upstream,
      timeout: 5000,
    });

    expect(result.statusCode).toBe(201);
    expect(result.body?.toString()).toBe('echo:payload');
  });

  it('prepends the upstream basePath to the request path', async () => {
    let receivedPath = '';
    const upstream = await startUpstream((req, res) => {
      receivedPath = req.url || '';
      res.writeHead(200);
      res.end();
    });
    const forwarder = new UrlForwarder(new HttpClientPool());

    await forwarder.forward({ method: 'GET', path: '/items', headers: {}, upstream, timeout: 5000 });

    expect(receivedPath).toBe('/api/items');
  });

  it('forwards custom headers to the upstream', async () => {
    const upstream = await startUpstream((req, res) => {
      res.writeHead(200);
      res.end(JSON.stringify({ auth: req.headers['x-custom-auth'], trace: req.headers['x-trace-id'] }));
    });
    const forwarder = new UrlForwarder(new HttpClientPool());

    const result = await forwarder.forward({
      method: 'GET',
      path: '/',
      headers: { 'x-custom-auth': 'Bearer tok', 'x-trace-id': 'tr-1' },
      upstream,
      timeout: 5000,
    });

    const echoed = JSON.parse(result.body?.toString() || '{}');
    expect(echoed.auth).toBe('Bearer tok');
    expect(echoed.trace).toBe('tr-1');
  });

  it('returns a non-2xx upstream response as a result, not a throw', async () => {
    const upstream = await startUpstream((req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"not found"}');
    });
    const forwarder = new UrlForwarder(new HttpClientPool());

    const result = await forwarder.forward({ method: 'GET', path: '/missing', headers: {}, upstream, timeout: 5000 });

    expect(result.statusCode).toBe(404);
    expect(result.body?.toString()).toBe('{"error":"not found"}');
  });

  it('throws on upstream timeout', async () => {
    const upstream = await startUpstream(() => {
      // never respond
    });
    upstream.timeout = 300;
    const forwarder = new UrlForwarder(new HttpClientPool());

    await expect(
      forwarder.forward({ method: 'GET', path: '/slow', headers: {}, upstream, timeout: 300 })
    ).rejects.toThrow(/timeout/i);
  });
});
