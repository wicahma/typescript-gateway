import { GatewayPolicy } from './policy.js';
import { RequestContext } from '../types/core.js';

export interface ShadowPolicyConfig {
  target: string;
  sampleRate?: number;
  methods?: string[];
  maxInflight?: number;
  fetchImpl?: typeof fetch;
  random?: () => number;
}

export interface ShadowStats {
  sampled: number;
  skipped: number;
}

const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export class ShadowPolicy implements GatewayPolicy {
  readonly name = 'shadow';

  private readonly target: string;
  private readonly sampleRate: number;
  private readonly methods: Set<string>;
  private readonly maxInflight: number;
  private readonly fetchImpl: typeof fetch;
  private readonly random: () => number;

  private inflightCount = 0;
  private sampled = 0;
  private skipped = 0;

  constructor(config: ShadowPolicyConfig) {
    this.target = config.target.replace(/\/+$/, '');
    this.sampleRate = config.sampleRate ?? 0.1;
    this.methods = new Set(config.methods ?? DEFAULT_METHODS);
    this.maxInflight = config.maxInflight ?? 64;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.random = config.random ?? Math.random;
  }

  executeInbound(ctx: RequestContext): void {
    if (!this.methods.has(ctx.method)) {
      this.skipped++;
      return;
    }
    if (this.inflightCount >= this.maxInflight) {
      this.skipped++;
      return;
    }
    if (this.random() >= this.sampleRate) {
      this.skipped++;
      return;
    }
    this.sampled++;
    this.mirror(ctx);
  }

  inflight(): number {
    return this.inflightCount;
  }

  getStats(): ShadowStats {
    return { sampled: this.sampled, skipped: this.skipped };
  }

  private mirror(ctx: RequestContext): void {
    const path = ctx.path.startsWith('/') ? ctx.path : `/${ctx.path}`;
    const url = `${this.target}${path}`;
    const headers: Record<string, string> = { 'x-shadow': 'true' };
    for (const key of Object.keys(ctx.headers)) {
      const value = ctx.headers[key];
      if (typeof value === 'string') headers[key] = value;
    }
    this.inflightCount++;
    try {
      const result = this.fetchImpl(url, {
        method: ctx.method,
        headers,
        body: ctx.body ?? undefined,
      });
      void Promise.resolve(result)
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          this.inflightCount--;
        });
    } catch {
      this.inflightCount--;
    }
  }
}
