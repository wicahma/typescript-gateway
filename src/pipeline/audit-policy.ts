import { GatewayPolicy, OutboundResponse } from './policy.js';
import { RequestContext } from '../types/core.js';

export interface AuditEvent {
  ts: string;
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  user?: string;
  upstream?: string;
  bytesOut?: number;
}

export interface AuditPolicyConfig {
  sink?: (line: string) => void;
  redactPatterns?: RegExp[];
  includeHeaders?: boolean;
  sampleRate?: number;
  random?: () => number;
}

const DEFAULT_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /"(?:secret|token|password|api[_-]?key)"\s*:\s*"[^"]{8,}"/gi,
];

const REDACTED = '[REDACTED]';

export class AuditPolicy implements GatewayPolicy {
  readonly name = 'audit';

  private readonly sink: (line: string) => void;
  private readonly patterns: RegExp[];
  private readonly includeHeaders: boolean;
  private readonly sampleRate: number;
  private readonly random: () => number;

  constructor(config: AuditPolicyConfig = {}) {
    this.sink = config.sink ?? (line => process.stdout.write(line + '\n'));
    this.patterns = config.redactPatterns ?? DEFAULT_PATTERNS;
    this.includeHeaders = config.includeHeaders ?? false;
    this.sampleRate = config.sampleRate ?? 1;
    this.random = config.random ?? Math.random;
  }

  private redact(text: string): string {
    let out = text;
    for (const pattern of this.patterns) {
      out = out.replace(pattern, REDACTED);
    }
    return out;
  }

  private sampled(): boolean {
    if (this.sampleRate >= 1) return true;
    return this.random() < this.sampleRate;
  }

  executeInbound(ctx: RequestContext): void {
    if (ctx.state['__auditStart'] === undefined) {
      ctx.state['__auditStart'] = Date.now();
    }
  }

  executeOutbound(ctx: RequestContext, response: OutboundResponse): void {
    if (ctx.state['__auditEmitted'] === true) return;
    ctx.state['__auditEmitted'] = true;
    if (!this.sampled()) return;
    const start = ctx.state['__auditStart'];
    const startMs = typeof start === 'number' ? start : Date.now();
    this.emit(ctx, response.statusCode, Date.now() - startMs, response.body?.length);
  }

  onComplete(ctx: RequestContext): void {
    if (ctx.state['__auditEmitted'] === true) return;
    ctx.state['__auditEmitted'] = true;
    if (!this.sampled()) return;
    const start = ctx.state['__auditStart'];
    const startMs = typeof start === 'number' ? start : Date.now();
    const status = ctx.responded ? ctx.res.statusCode || 0 : 0;
    this.emit(ctx, status, Date.now() - startMs, undefined);
  }

  private emit(
    ctx: RequestContext,
    status: number,
    durationMs: number,
    bytesOut: number | undefined
  ): void {
    const event: AuditEvent = {
      ts: new Date().toISOString(),
      requestId: ctx.requestId,
      method: this.redact(ctx.method),
      path: this.redact(ctx.path),
      status,
      durationMs,
    };
    const user = ctx.state['user'] as { sub?: string } | undefined;
    if (user?.sub) event.user = user.sub;
    if (ctx.upstream) event.upstream = ctx.upstream.id;
    if (bytesOut !== undefined) event.bytesOut = bytesOut;
    if (this.includeHeaders) {
      const headers: Record<string, string> = {};
      for (const key of Object.keys(ctx.headers)) {
        const value = ctx.headers[key];
        if (typeof value === 'string') headers[key] = this.redact(value);
        else if (Array.isArray(value)) headers[key] = this.redact(value.join(', '));
      }
      (event as AuditEvent & { headers?: Record<string, string> }).headers = headers;
    }
    this.sink(JSON.stringify(event));
  }
}
