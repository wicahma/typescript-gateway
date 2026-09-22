/**
 * Minimal OpenAPI 3.1 generator.
 * Builds the document from the live GatewayConfig (routes + upstreams),
 * zero dependencies. Serve it at an endpoint of your choice.
 */

import { GatewayConfig, Route, UpstreamTarget } from '../types/core.js';

export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
}

export interface OpenApiDoc {
  openapi: '3.1.0';
  info: OpenApiInfo;
  paths: Record<string, Record<string, unknown>>;
  servers: { url: string; description?: string }[];
  tags?: { name: string; description?: string }[];
}

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'] as const;

/**
 * Convert gateway path syntax (`/users/:id`, `/files/*`) to OpenAPI
 * (`/users/{id}`, `/files/{wildcard}`).
 */
export function toOpenApiPath(path: string): { path: string; params: string[] } {
  const params: string[] = [];
  const converted = path
    .split('/')
    .map((seg) => {
      if (seg === '*') {
        params.push('wildcard');
        return '{wildcard}';
      }
      if (seg.startsWith(':')) {
        const name = seg.slice(1);
        params.push(name);
        return `{${name}}`;
      }
      return seg;
    })
    .join('/');
  return { path: converted, params };
}

function operationFor(route: Route): Record<string, unknown> {
  const { path, params } = toOpenApiPath(route.path);
  const op: Record<string, unknown> = {
    summary: route.handler.name ? `${route.handler.name} handler` : `${route.method} ${path}`,
    operationId: `${route.method.toLowerCase()}_${path.replace(/[^a-zA-Z0-9]+/g, '_')}`,
    responses: {
      '200': { description: 'Successful response (proxied)' },
      '502': { description: 'Upstream error' },
      '504': { description: 'Upstream timeout' },
    },
  };

  if (params.length > 0) {
    op['parameters'] = params.map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
  }

  return op;
}

/**
 * Build an OpenAPI 3.1 document from the gateway config.
 * Routes are grouped by their first path segment as tags.
 */
export function generateOpenApi(config: GatewayConfig, info: OpenApiInfo): OpenApiDoc {
  const paths: Record<string, Record<string, unknown>> = {};
  const tagNames = new Set<string>();

  for (const route of config.routes) {
    const { path } = toOpenApiPath(route.path);
    const method = route.method.toLowerCase();
    if (!(METHODS as readonly string[]).includes(method)) continue;

    const tag = path.split('/').filter(Boolean)[0] ?? 'default';
    tagNames.add(tag);

    const op = operationFor(route);
    op['tags'] = [tag];

    if (!paths[path]) paths[path] = {};
    paths[path][method] = op;
  }

  return {
    openapi: '3.1.0',
    info,
    paths,
    servers: (config.upstreams as UpstreamTarget[]).map((u) => ({
      url: `${u.protocol}://${u.host}:${u.port}${u.basePath}`,
      description: u.id,
    })),
    tags: [...tagNames].sort().map((name) => ({ name })),
  };
}
