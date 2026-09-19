import { OutgoingHttpHeaders } from 'node:http';
import { RequestContext } from '../types/core.js';
import { GatewayPolicy, OutboundResponse } from '../pipeline/policy.js';
import { ResponseCache } from './response-cache.js';

interface CachePolicyConfig {
  cacheableMethods?: string[];
}

export class ResponseCachePolicy implements GatewayPolicy {
  readonly name = 'response-cache';

  private cache: ResponseCache;
  private cacheableMethods: Set<string>;

  constructor(cache: ResponseCache, config: CachePolicyConfig = {}) {
    this.cache = cache;
    this.cacheableMethods = new Set(config.cacheableMethods ?? ['GET', 'HEAD']);
  }

  executeInbound(ctx: RequestContext): Response | void {
    if (!this.cacheableMethods.has(ctx.method)) return;
    const key = this.cache.generateKey(ctx.method, ctx.path, ctx.headers);
    const hit = this.cache.get(key);
    if (!hit) return;
    ctx.state['cacheHit'] = true;
    const headers = new Headers();
    for (const [key, value] of Object.entries(normalizeHeaders(hit.headers))) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
      else headers.set(key, String(value));
    }
    headers.set('x-cache', 'HIT');
    return new Response(new Uint8Array(hit.body), {
      status: hit.statusCode,
      headers,
    });
  }

  executeOutbound(ctx: RequestContext, response: OutboundResponse): OutboundResponse | void {
    if (!this.cacheableMethods.has(ctx.method)) return;
    if (!response.body) return;
    const headerRecord = toRecord(response.headers);
    if (!ResponseCache.isCacheable(response.statusCode, headerRecord, ctx.method)) return;
    const key = this.cache.generateKey(ctx.method, ctx.path, ctx.headers);
    const cacheControl = ResponseCache.parseCacheControl(
      typeof headerRecord['cache-control'] === 'string' ? headerRecord['cache-control'] : undefined
    );
    this.cache.set(key, {
      statusCode: response.statusCode,
      headers: headerRecord,
      body: response.body,
      cachedAt: Date.now(),
      ttl: this.cache.getTTL(cacheControl),
      size: response.body.length,
    });
    response.headers['x-cache'] = 'MISS';
    return response;
  }
}

function toRecord(headers: OutgoingHttpHeaders): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) out[key] = value.map(String);
    else if (typeof value === 'number') out[key] = String(value);
    else out[key] = value;
  }
  return out;
}

function normalizeHeaders(headers: Record<string, string | string[]>): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key === 'content-length' || key === 'transfer-encoding') continue;
    out[key] = value;
  }
  return out;
}
