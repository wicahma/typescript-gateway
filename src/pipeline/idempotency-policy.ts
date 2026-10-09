import { createHash } from 'node:crypto';
import { GatewayPolicy, OutboundResponse } from './policy.js';
import { RequestContext } from '../types/core.js';
import { HttpProblems } from './http-problems.js';

export interface IdempotencyConfig {
  headerName?: string;
  methods?: string[];
  ttlMs?: number;
  maxEntries?: number;
}

interface Entry {
  fingerprint: string;
  statusCode: number | null;
  headers: Record<string, string | string[] | undefined> | null;
  body: Buffer | null;
  expiresAt: number;
  complete: boolean;
}

export class IdempotencyPolicy implements GatewayPolicy {
  readonly name = 'idempotency';
  private readonly headerName: string;
  private readonly methods: Set<string>;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly store = new Map<string, Entry>();

  constructor(config: IdempotencyConfig = {}) {
    this.headerName = config.headerName ?? 'idempotency-key';
    this.methods = new Set(config.methods ?? ['POST', 'PATCH']);
    this.ttlMs = config.ttlMs ?? 86_400_000;
    this.maxEntries = config.maxEntries ?? 10_000;
  }

  private keyOf(ctx: RequestContext): string | null {
    const raw = ctx.headers[this.headerName];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value ? value : null;
  }

  private fingerprintOf(ctx: RequestContext): string {
    const body = ctx.body ? ctx.body.toString('base64') : '';
    return createHash('sha256').update(`${ctx.method}\n${ctx.path}\n${body}`).digest('hex');
  }

  executeInbound(ctx: RequestContext): Response | void {
    if (!this.methods.has(ctx.method)) return;
    const key = this.keyOf(ctx);
    if (!key) return;
    this.evict();

    const existing = this.store.get(key);
    if (existing) {
      if (existing.fingerprint !== this.fingerprintOf(ctx)) {
        return HttpProblems.badRequest('Idempotency-Key reused with a different payload', {
          requestId: ctx.requestId,
        });
      }
      if (!existing.complete) {
        return HttpProblems.conflict('Request with this Idempotency-Key is still in flight', {
          requestId: ctx.requestId,
        });
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(existing.headers ?? {})) {
        if (value === undefined) continue;
        headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
      }
      headers.set('idempotent-replay', 'true');
      ctx.state['idempotentReplay'] = true;
      return new Response(existing.body ?? null, { status: existing.statusCode ?? 200, headers });
    }

    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, {
      fingerprint: this.fingerprintOf(ctx),
      statusCode: null,
      headers: null,
      body: null,
      expiresAt: Date.now() + this.ttlMs,
      complete: false,
    });
  }

  executeOutbound(ctx: RequestContext, response: OutboundResponse): OutboundResponse | void {
    if (!this.methods.has(ctx.method)) return;
    const key = this.keyOf(ctx);
    if (!key) return;
    const entry = this.store.get(key);
    if (!entry) return;
    entry.statusCode = response.statusCode;
    entry.headers = response.headers as Record<string, string | string[] | undefined>;
    entry.body = response.body ?? null;
    entry.complete = true;
  }

  private evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(key);
    }
  }
}
