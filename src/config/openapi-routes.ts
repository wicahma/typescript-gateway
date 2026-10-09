import { HttpMethod } from '../types/core.js';

export interface OpenApiRoute {
  method: HttpMethod;
  path: string;
  operationId?: string;
  upstreamId?: string;
}

export interface OpenApiRouteOptions {
  upstreamId?: string;
  basePath?: string;
}

const OPERATIONS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);

export function routesFromOpenApi(
  spec: unknown,
  options: OpenApiRouteOptions = {}
): OpenApiRoute[] {
  if (!spec || typeof spec !== 'object') {
    throw new Error('ERR_OPENAPI_INVALID_SPEC');
  }
  const doc = spec as { paths?: Record<string, Record<string, unknown>> };
  if (!doc.paths || typeof doc.paths !== 'object') {
    throw new Error('ERR_OPENAPI_NO_PATHS');
  }

  const base = (options.basePath ?? '').replace(/\/+$/, '');
  const routes: OpenApiRoute[] = [];

  for (const [rawPath, item] of Object.entries(doc.paths)) {
    if (!item || typeof item !== 'object') continue;
    const normalized = normalize(rawPath);
    const fullPath = base ? `${base}${normalized}` : normalized;
    for (const [key, value] of Object.entries(item)) {
      if (!OPERATIONS.has(key)) continue;
      const op = value && typeof value === 'object' ? (value as { operationId?: string }) : {};
      const route: OpenApiRoute = { method: key.toUpperCase() as HttpMethod, path: fullPath };
      if (typeof op.operationId === 'string') route.operationId = op.operationId;
      if (options.upstreamId) route.upstreamId = options.upstreamId;
      routes.push(route);
    }
  }

  return routes;
}

function normalize(path: string): string {
  const withParams = path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1');
  if (withParams.length > 1 && withParams.endsWith('/')) return withParams.slice(0, -1);
  return withParams;
}
