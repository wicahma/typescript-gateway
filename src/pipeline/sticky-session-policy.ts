import { GatewayPolicy } from './policy.js';
import { RequestContext } from '../types/core.js';

export interface StickySessionConfig {
  upstreams: string[];
  headerName?: string;
  cookieName?: string;
  ttlMs?: number;
  maxSessions?: number;
}

interface SessionPin {
  upstreamId: string;
  expiresAt: number;
}

export class StickySessionPolicy implements GatewayPolicy {
  readonly name = 'sticky-session';
  private readonly upstreams: string[];
  private readonly headerName: string;
  private readonly cookieName: string;
  private readonly ttlMs: number;
  private readonly maxSessions: number;
  private readonly sessions = new Map<string, SessionPin>();

  constructor(config: StickySessionConfig) {
    if (!config.upstreams || config.upstreams.length === 0) {
      throw new Error('StickySessionPolicy requires at least one upstream');
    }
    this.upstreams = config.upstreams;
    this.headerName = config.headerName ?? 'x-session-id';
    this.cookieName = config.cookieName ?? 'tsgate_sid';
    this.ttlMs = config.ttlMs ?? 3600000;
    this.maxSessions = config.maxSessions ?? 10000;
  }

  executeInbound(ctx: RequestContext): void {
    try {
      const key = this.resolveKey(ctx);
      if (!key) return;

      this.evictExpired();
      const now = Date.now();
      const existing = this.sessions.get(key);
      if (existing && existing.expiresAt > now) {
        ctx.state['stickyUpstreamId'] = existing.upstreamId;
        return;
      }

      const upstreamId = this.pickUpstream(key);
      this.sessions.delete(key);
      this.sessions.set(key, { upstreamId, expiresAt: now + this.ttlMs });
      this.enforceLimit();
      ctx.state['stickyUpstreamId'] = upstreamId;
    } catch {
      return;
    }
  }

  getSessionCount(): number {
    this.evictExpired();
    return this.sessions.size;
  }

  reset(): void {
    this.sessions.clear();
  }

  private resolveKey(ctx: RequestContext): string | null {
    const headerValue = ctx.headers[this.headerName];
    const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (header) return header;

    const cookieValue = ctx.headers['cookie'];
    const cookieHeader = Array.isArray(cookieValue) ? cookieValue.join('; ') : cookieValue;
    if (!cookieHeader) return null;

    for (const part of cookieHeader.split(';')) {
      const separator = part.indexOf('=');
      if (separator === -1) continue;
      const name = part.slice(0, separator).trim();
      if (name === this.cookieName) {
        const value = part.slice(separator + 1).trim();
        return value || null;
      }
    }
    return null;
  }

  private pickUpstream(key: string): string {
    return this.upstreams[this.hash(key) % this.upstreams.length];
  }

  private hash(value: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, pin] of this.sessions) {
      if (pin.expiresAt <= now) this.sessions.delete(key);
    }
  }

  private enforceLimit(): void {
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) return;
      this.sessions.delete(oldest);
    }
  }
}
