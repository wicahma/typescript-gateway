import { describe, it, expect } from 'vitest';
import { routesFromOpenApi } from '../../src/config/openapi-routes.js';

const SPEC = {
  openapi: '3.1.0',
  info: { title: 'Test API', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/users': {
      get: { operationId: 'listUsers' },
      post: { operationId: 'createUser' },
    },
    '/users/{id}': {
      get: { operationId: 'getUser' },
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    },
    '/orders/{orderId}': {
      delete: { operationId: 'deleteOrder' },
    },
  },
};

describe('routesFromOpenApi', () => {
  it('produces one route per method+path', () => {
    const routes = routesFromOpenApi(SPEC);
    expect(routes).toHaveLength(4);
    const paths = routes.map(r => `${r.method} ${r.path}`).sort();
    expect(paths).toEqual([
      'DELETE /orders/:orderId',
      'GET /users',
      'GET /users/:id',
      'POST /users',
    ]);
  });

  it('carries operationId as the route name', () => {
    const routes = routesFromOpenApi(SPEC);
    const getUser = routes.find(r => r.method === 'GET' && r.path === '/users/:id');
    expect(getUser?.operationId).toBe('getUser');
  });

  it('normalizes {param} to :param', () => {
    const routes = routesFromOpenApi(SPEC);
    expect(routes.some(r => r.path.includes('{'))).toBe(false);
  });

  it('attaches the first server url as upstream base when requested', () => {
    const routes = routesFromOpenApi(SPEC, { upstreamId: 'svc' });
    expect(routes.every(r => r.upstreamId === 'svc')).toBe(true);
  });

  it('skips non-operation keys like parameters and summary', () => {
    const routes = routesFromOpenApi({
      openapi: '3.1.0',
      paths: {
        '/x': { summary: 'x', parameters: [], get: {} },
      },
    });
    expect(routes).toHaveLength(1);
    expect(routes[0]!.method).toBe('GET');
  });

  it('throws on a spec without paths', () => {
    expect(() => routesFromOpenApi({ openapi: '3.1.0' })).toThrow();
  });
});
