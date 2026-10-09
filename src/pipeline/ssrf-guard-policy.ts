import { GatewayPolicy } from './policy.js';
import { RequestContext } from '../types/core.js';
import { HttpProblems } from './http-problems.js';

export interface SsrfGuardConfig {
  allowlist?: string[];
  allowPrivate?: boolean;
  blockLinkLocal?: boolean;
}

const LOOPBACK_V6 = '::1';

function stripBrackets(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
  return host;
}

function isPrivateIpv4(host: string, blockLinkLocal: boolean): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  if (!parts.every(p => /^\d{1,3}$/.test(p))) return false;
  const octets = parts.map(Number);
  if (octets.some(n => n > 255)) return false;
  const a = octets[0] ?? -1;
  const b = octets[1] ?? -1;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 0 && octets[1] === 0 && octets[2] === 0 && octets[3] === 0) return true;
  if (blockLinkLocal && a === 169 && b === 254) return true;
  return false;
}

function isPrivateIpv6(host: string, blockLinkLocal: boolean): boolean {
  if (!host.includes(':')) return false;
  if (host === LOOPBACK_V6) return true;
  const lower = host.toLowerCase();
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (blockLinkLocal && lower.startsWith('fe80')) return true;
  return false;
}

export function isPrivateHost(host: string, opts: { blockLinkLocal: boolean }): boolean {
  const normalized = stripBrackets(host.trim().toLowerCase());
  if (normalized.length === 0) return false;
  if (normalized === 'localhost') return true;
  if (normalized.endsWith('.localhost')) return true;
  if (normalized.endsWith('.internal')) return true;
  if (isPrivateIpv6(normalized, opts.blockLinkLocal)) return true;
  if (isPrivateIpv4(normalized, opts.blockLinkLocal)) return true;
  return false;
}

export class SsrfGuardPolicy implements GatewayPolicy {
  readonly name = 'ssrf-guard';
  private readonly allowlist: string[];
  private readonly allowPrivate: boolean;
  private readonly blockLinkLocal: boolean;

  constructor(config: SsrfGuardConfig = {}) {
    this.allowlist = (config.allowlist ?? []).map(h => stripBrackets(h.toLowerCase()));
    this.allowPrivate = config.allowPrivate ?? false;
    this.blockLinkLocal = config.blockLinkLocal ?? true;
  }

  executeInbound(ctx: RequestContext): Response | void {
    if (this.allowPrivate) return;

    const stateHost = ctx.state['ssrfTargetHost'];
    const paramHost = ctx.params['host'];
    const raw = typeof stateHost === 'string' && stateHost.length > 0 ? stateHost : paramHost;
    if (typeof raw !== 'string' || raw.length === 0) return;

    const host = stripBrackets(raw.trim().toLowerCase());
    if (host.length === 0) return;
    if (this.allowlist.includes(host)) return;
    if (isPrivateHost(host, { blockLinkLocal: this.blockLinkLocal })) {
      return HttpProblems.forbidden('Target host is not allowed', { requestId: ctx.requestId });
    }
  }
}
