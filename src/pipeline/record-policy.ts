import { GatewayPolicy, OutboundResponse } from './policy.js';
import { RequestContext } from '../types/core.js';
import { RecordStore, RecordedExchange } from './record-store.js';

export interface RecordPolicyConfig {
  store?: RecordStore;
  maxEntries?: number;
  captureBody?: boolean;
  methods?: string[];
}

interface Pending {
  requestId: string;
  ts: number;
  method: string;
  path: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
}

function flatten(source: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

export class RecordPolicy implements GatewayPolicy {
  readonly name = 'record';

  private readonly store: RecordStore;
  private readonly captureBody: boolean;
  private readonly methods: Set<string> | null;
  private readonly pending = new Map<string, Pending>();

  constructor(config: RecordPolicyConfig = {}) {
    this.store = config.store ?? new RecordStore(config.maxEntries ?? 1000);
    this.captureBody = config.captureBody ?? false;
    this.methods = config.methods ? new Set(config.methods) : null;
  }

  executeInbound(ctx: RequestContext): void {
    if (this.methods && !this.methods.has(ctx.method)) return;
    this.pending.set(ctx.requestId, {
      requestId: ctx.requestId,
      ts: Date.now(),
      method: ctx.method,
      path: ctx.path,
      requestHeaders: flatten(ctx.headers),
      requestBody: this.captureBody ? (ctx.body?.toString('utf8') ?? null) : null,
    });
  }

  executeOutbound(ctx: RequestContext, response: OutboundResponse): void {
    const snapshot = this.pending.get(ctx.requestId);
    if (!snapshot) return;
    this.pending.delete(ctx.requestId);
    const exchange: RecordedExchange = {
      requestId: snapshot.requestId,
      ts: snapshot.ts,
      method: snapshot.method,
      path: snapshot.path,
      requestHeaders: snapshot.requestHeaders,
      requestBody: snapshot.requestBody,
      statusCode: response.statusCode,
      responseHeaders: flatten(response.headers as Record<string, unknown>),
      responseBody: response.body?.toString('utf8') ?? null,
    };
    this.store.save(exchange);
  }

  getStore(): RecordStore {
    return this.store;
  }
}
