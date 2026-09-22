import { describe, it, expect } from 'vitest';
import { generateOpenApi, toOpenApiPath } from '../../src/core/openapi-generator.js';
import { GatewayConfig, HttpMethod, Route } from '../../src/types/core.js';

function makeRoute(method: HttpMethod, path: string): Route {
  return { method, path, handler: () => {}, priority: 0 };
}

function makeConfig(routes: Route[]): GatewayConfig {
  return {
    server: { host: '0.0.0.0', port: 8080 },
    routes,
    upstreams: [
      {
        id: 'api', protocol: 'http', host: '127.0.0.1', port: 9000,
        basePath: '/v1', poolSize: 5, timeout: 5000,
        healthCheck: { enabled: false, interval: 1000, path: '/', timeout: 1000, healthyThreshold: 1, unhealthyThreshold: 1 },
        healthy: true, circuitBreaker: { state: 'CLOSED', failures: 0, successes: 0, lastFailure: 0 },
      },
    ],
    plugins: [],
    performance: { workerThreads: 0, maxConnections: 100, keepAliveTimeout: 5000, headersTimeout: 60000, requestTimeout: 30000 },
  } as unknown as GatewayConfig;
}

describe('openapi-generator', () => {
  it('converts :param and * path segments to OpenAPI templating', () => {
    expect(toOpenApiPath('/users/:id')).toEqual({ path: '/users/{id}', params: ['id'] });
    expect(toOpenApiPath('/files/*')).toEqual({ path: '/files/{wildcard}', params: ['wildcard'] });
    expect(toOpenApiPath('/health')).toEqual({ path: '/health', params: [] });
  });

  it('emits one operation per route under the converted path', () => {
    const config = makeConfig([
      makeRoute('GET' as HttpMethod, '/users/:id'),
      makeRoute('POST' as HttpMethod, '/users/:id'),
      makeRoute('GET' as HttpMethod, '/health'),
    ]);
    const doc = generateOpenApi(config, { title: 'tsgate', version: '1.4.2' });

    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths).sort()).toEqual(['/health', '/users/{id}']);
    const userOps = doc.paths['/users/{id}']!;
    expect(Object.keys(userOps).sort()).toEqual(['get', 'post']);
    const get = userOps['get'] as Record<string, unknown>;
    expect(get['tags']).toEqual(['users']);
    expect((get['parameters'] as unknown[]).length).toBe(1);
  });

  it('groups routes into tags by first path segment and lists upstream servers', () => {
    const config = makeConfig([
      makeRoute('GET' as HttpMethod, '/users/:id'),
      makeRoute('GET' as HttpMethod, '/orders/:id'),
    ]);
    const doc = generateOpenApi(config, { title: 't', version: '0' });
    expect(doc.tags!.map((t) => t.name)).toEqual(['orders', 'users']);
    expect(doc.servers[0]).toEqual({ url: 'http://127.0.0.1:9000/v1', description: 'api' });
  });
});
