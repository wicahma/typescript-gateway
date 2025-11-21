import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Server } from '../../src/core/server';
import { Router } from '../../src/core/router';
import { ServerConfig } from '../../src/types/core';
import http from 'http';

describe('Server Integration Tests', () => {
  let server: Server;
  let router: Router;
  const config: ServerConfig = {
    port: 0, // Random port
    host: '127.0.0.1',
    keepAlive: true,
    keepAliveTimeout: 65000,
    requestTimeout: 30000,
    maxHeaderSize: 8192,
    maxBodySize: 1024 * 1024,
  };

  beforeEach(async () => {
    router = new Router();
    server = new Server(config, router);
  });

  afterEach(async () => {
    await server.stop();
  });

  it('should handle GET request to registered route', async () => {
    router.register('GET', '/test', async ctx => {
      ctx.res.writeHead(200, { 'Content-Type': 'text/plain' });
      ctx.res.end('Hello World');
      ctx.responded = true;
    });

    await server.start();
    const port = (server.getServer().address() as any)?.port;

    const response = await makeRequest('GET', `http://127.0.0.1:${port}/test`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('Hello World');
  });

  it('should return 404 for unregistered route', async () => {
    await server.start();
    const port = (server.getServer().address() as any)?.port;

    const response = await makeRequest('GET', `http://127.0.0.1:${port}/nonexistent`);
    expect(response.statusCode).toBe(404);
    expect(response.body).toBe('Not Found');
  });

  it('should handle dynamic routes with parameters', async () => {
    router.register('GET', '/users/:id', async ctx => {
      ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify({ userId: ctx.params.id }));
      ctx.responded = true;
    });

    await server.start();
    const port = (server.getServer().address() as any)?.port;

    const response = await makeRequest('GET', `http://127.0.0.1:${port}/users/123`);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ userId: '123' });
  });

  it('should handle multiple concurrent requests', async () => {
    let requestCount = 0;
    router.register('GET', '/counter', async ctx => {
      requestCount++;
      ctx.res.writeHead(200, { 'Content-Type': 'text/plain' });
      ctx.res.end(`Request ${requestCount}`);
      ctx.responded = true;
    });

    await server.start();
    const port = (server.getServer().address() as any)?.port;

    // Make 10 concurrent requests
    const promises = Array.from({ length: 10 }, () =>
      makeRequest('GET', `http://127.0.0.1:${port}/counter`)
    );

    const responses = await Promise.all(promises);
    expect(responses).toHaveLength(10);
    responses.forEach(r => expect(r.statusCode).toBe(200));
    expect(requestCount).toBe(10);
  });

  it('should track active connections', async () => {
    router.register('GET', '/test', async ctx => {
      ctx.res.writeHead(200);
      ctx.res.end('OK');
      ctx.responded = true;
    });

    await server.start();
    const port = (server.getServer().address() as any)?.port;

    // Initially no connections
    expect(server.getActiveConnectionCount()).toBe(0);

    // Make request
    await makeRequest('GET', `http://127.0.0.1:${port}/test`);

    // Connection should be closed after response (or soon after)
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  it('should report pool statistics', async () => {
    router.register('GET', '/test', async ctx => {
      ctx.res.writeHead(200);
      ctx.res.end('OK');
      ctx.responded = true;
    });

    await server.start();
    const port = (server.getServer().address() as any)?.port;

    // Make some requests
    for (let i = 0; i < 10; i++) {
      await makeRequest('GET', `http://127.0.0.1:${port}/test`);
    }

    const stats = server.getPoolStats();
    expect(stats.totalAcquired).toBeGreaterThanOrEqual(10);
    expect(stats.hits).toBeGreaterThan(0);
  });

  it('should handle route with query parameters', async () => {
    router.register('GET', '/search', async ctx => {
      const query = ctx.query || {};
      ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify({ query }));
      ctx.responded = true;
    });

    await server.start();
    const port = (server.getServer().address() as any)?.port;

    const response = await makeRequest('GET', `http://127.0.0.1:${port}/search?q=test&limit=10`);
    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.body);
    expect(data.query).toEqual({ q: 'test', limit: '10' });
  });

  it('should handle errors in route handlers', async () => {
    router.register('GET', '/error', async () => {
      throw new Error('Test error');
    });

    await server.start();
    const port = (server.getServer().address() as any)?.port;

    const response = await makeRequest('GET', `http://127.0.0.1:${port}/error`);
    expect(response.statusCode).toBe(500);
    expect(response.body).toBe('Internal Server Error');
  });

  it('should have high pool hit rate', async () => {
    router.register('GET', '/test', async ctx => {
      ctx.res.writeHead(200);
      ctx.res.end('OK');
      ctx.responded = true;
    });

    await server.start();
    const port = (server.getServer().address() as any)?.port;

    // Make 100 requests
    for (let i = 0; i < 100; i++) {
      await makeRequest('GET', `http://127.0.0.1:${port}/test`);
    }

    const hitRate = server.getPoolHitRate();
    expect(hitRate).toBeGreaterThan(95); // > 95% target
  });
});

// Helper function to make HTTP requests
function makeRequest(
  method: string,
  url: string
): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
      },
      res => {
        let body = '';
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body,
            headers: res.headers,
          });
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}
