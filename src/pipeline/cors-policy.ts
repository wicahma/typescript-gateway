import { GatewayPolicy } from './policy.js';
import { RequestContext } from '../types/core.js';
import { HttpProblems } from './http-problems.js';

export interface CorsConfig {
  allowOrigins?: string[];
  allowMethods?: string[];
  allowHeaders?: string[];
  exposeHeaders?: string[];
  allowCredentials?: boolean;
  maxAgeSeconds?: number;
}

export class CorsPolicy implements GatewayPolicy {
  readonly name = 'cors';
  private readonly origins: string[];
  private readonly methods: string[];
  private readonly headers: string[];
  private readonly expose: string[];
  private readonly credentials: boolean;
  private readonly maxAge: number;

  constructor(config: CorsConfig = {}) {
    this.origins = config.allowOrigins ?? ['*'];
    this.methods = config.allowMethods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
    this.headers = config.allowHeaders ?? ['content-type', 'authorization', 'x-api-key', 'idempotency-key'];
    this.expose = config.exposeHeaders ?? [];
    this.credentials = config.allowCredentials ?? false;
    this.maxAge = config.maxAgeSeconds ?? 600;
  }

  private resolveOrigin(origin: string | undefined): string | null {
    if (!origin) return null;
    if (this.origins.includes('*')) return this.credentials ? origin : '*';
    return this.origins.includes(origin) ? origin : null;
  }

  executeInbound(ctx: RequestContext): Response | void {
    const raw = ctx.headers['origin'];
    const origin = Array.isArray(raw) ? raw[0] : raw;
    const allowed = this.resolveOrigin(origin);
    const isPreflight = ctx.method === 'OPTIONS' && Boolean(ctx.headers['access-control-request-method']);

    if (isPreflight) {
      if (!allowed) {
        return HttpProblems.forbidden('Origin not allowed', { requestId: ctx.requestId });
      }
      const headers = new Headers();
      headers.set('access-control-allow-origin', allowed);
      headers.set('access-control-allow-methods', this.methods.join(', '));
      headers.set('access-control-allow-headers', this.headers.join(', '));
      headers.set('access-control-max-age', String(this.maxAge));
      if (this.credentials) headers.set('access-control-allow-credentials', 'true');
      if (this.expose.length) headers.set('access-control-expose-headers', this.expose.join(', '));
      return new Response(null, { status: 204, headers });
    }

    if (allowed) {
      ctx.res.setHeader('access-control-allow-origin', allowed);
      if (this.credentials) ctx.res.setHeader('access-control-allow-credentials', 'true');
      if (this.expose.length) ctx.res.setHeader('access-control-expose-headers', this.expose.join(', '));
      ctx.res.setHeader('vary', 'origin');
    }
  }
}
