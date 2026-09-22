import { OutgoingHttpHeaders } from 'node:http';
import { RequestContext } from '../types/core.js';
import { GatewayPolicy, OutboundResponse } from '../pipeline/policy.js';
import { ResponseCache } from './response-cache.js';

interface CachePolicyConfig {
  cacheableMethods?: string[];
  /**
   * Background revalidator. When a stale entry is served (stale-while-
   * revalidate window), the policy invokes this with the cache key so the
   * gateway can refresh the entry off the request path. The caller decides
   * how to re-fetch (the policy cannot self-invoke the pipeline).
   */
  onStaleRevalidate?: (key: string, ctx: RequestContext) => void;
}

export class ResponseCachePolicy implements GatewayPolicy {
  readonly name = 'response-cache';

  private cache: ResponseCache;
  private cacheableMethods: Set<string>;
  private onStaleRevalidate?: (key: string, ctx: RequestContext) => void;
  private revalidating = new Set<string>();

  constructor(cache: ResponseCache, config: CachePolicyConfig = {}) {
    this.cache = cache;
    this.cacheableMethods = new Set(config.cacheableMethods ?? ['GET', 'HEAD']);
    this.onStaleRevalidate = config.onStaleRevalidate;
  }

  executeInbound(ctx: RequestContext): Response | void {
    if (!this.cacheableMethods.has(ctx.method)) return;
    const key = this.cache.generateKey(ctx.method, ctx.path, ctx.headers);
    // Vary-aware: entry may live under a vary-sensitive key derived from
    // the response Vary header. Probe the request key first (zero cost when
    // the response never varied), re-key only on miss with stored vary.
    let probe = this.cache.lookup(key);
    if (probe.state === 'miss') {
      const varyNames = this.cache.varyOf(key);
      if (varyNames.length > 0) {
        const varyHeaders: Record<string, string | string[] | undefined> = {};
        for (const name of varyNames) varyHeaders[name] = ctx.headers[name];
        probe = this.cache.lookup(this.cache.generateKey(ctx.method, ctx.path, varyHeaders));
      }
    }
    const { response: hit, state } = probe;
    if (!hit) return;
    ctx.state['cacheHit'] = true;

    // ponytail: single-flight per key per SWR window — mark in-flight until
    // the entry is refreshed (executeOutbound clears the mark), NOT until the
    // callback returns. One extra upstream fetch per window, no stampede.
    // Upgrade path: track in-flight promise and coalesce results.
    if (state === 'stale' && this.onStaleRevalidate && !this.revalidating.has(key)) {
      this.revalidating.add(key);
      setImmediate(() => {
        try {
          this.onStaleRevalidate?.(key, ctx);
        } catch {
          this.revalidating.delete(key);
        }
      });
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(normalizeHeaders(hit.headers))) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
      else headers.set(key, String(value));
    }
    headers.set('x-cache', state === 'stale' ? 'STALE' : 'HIT');
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
    // Re-key with Vary headers when the upstream response declares Vary.
    const varyRaw = headerRecord['vary'];
    const varyStr = Array.isArray(varyRaw) ? varyRaw.join(',') : varyRaw;
    let key = this.cache.generateKey(ctx.method, ctx.path, ctx.headers);
    if (typeof varyStr === 'string') {
      const names = varyStr.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
      if (names.length > 0) {
        const varyHeaders: Record<string, string | string[] | undefined> = {};
        for (const name of names) varyHeaders[name] = ctx.headers[name];
        key = this.cache.generateKey(ctx.method, ctx.path, varyHeaders);
      }
    }
    this.revalidating.delete(key); // refresh landed: next SWR window may revalidate
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
      staleWhileRevalidate: cacheControl.staleWhileRevalidate,
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
