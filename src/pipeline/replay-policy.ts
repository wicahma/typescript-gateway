import { GatewayPolicy } from './policy.js';
import { RequestContext } from '../types/core.js';
import { RecordStore } from './record-store.js';
import { HttpProblems } from './http-problems.js';

export interface ReplayPolicyConfig {
  store: RecordStore;
  headerName?: string;
  maxAgeMs?: number;
}

export class ReplayPolicy implements GatewayPolicy {
  readonly name = 'replay';

  private readonly store: RecordStore;
  private readonly headerName: string;
  private readonly maxAgeMs: number | undefined;

  constructor(config: ReplayPolicyConfig) {
    this.store = config.store;
    this.headerName = (config.headerName ?? 'x-replay-id').toLowerCase();
    this.maxAgeMs = config.maxAgeMs;
  }

  executeInbound(ctx: RequestContext): Response | void {
    const raw = ctx.headers[this.headerName];
    const id = Array.isArray(raw) ? raw[0] : raw;
    if (!id) return;

    const record = this.store.get(id);
    if (!record) {
      return HttpProblems.notFound('No recorded exchange for the given id', {
        requestId: ctx.requestId,
      });
    }
    if (this.maxAgeMs !== undefined && Date.now() - record.ts > this.maxAgeMs) {
      return HttpProblems.conflict('Recorded exchange expired', { requestId: ctx.requestId });
    }

    const headers = new Headers();
    for (const key of Object.keys(record.responseHeaders)) {
      const value = record.responseHeaders[key];
      if (value === undefined) continue;
      headers.set(key, value);
    }
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    headers.set('x-replay', 'hit');
    headers.set('x-replay-id', id);
    return new Response(record.responseBody ?? null, {
      status: record.statusCode,
      headers,
    });
  }
}
