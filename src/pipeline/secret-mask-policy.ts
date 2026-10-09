import { GatewayPolicy, OutboundResponse } from './policy.js';
import { RequestContext } from '../types/core.js';

const DEFAULT_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /"(?:secret|token|password|api[_-]?key)"\s*:\s*"[^"]{8,}"/gi,
];

export interface SecretMaskConfig {
  patterns?: RegExp[];
  replacement?: string;
  contentTypes?: string[];
}

export class SecretMaskPolicy implements GatewayPolicy {
  readonly name = 'secret-mask';
  private readonly patterns: RegExp[];
  private readonly replacement: string;
  private readonly contentTypes: string[];

  constructor(config: SecretMaskConfig = {}) {
    this.patterns = config.patterns ?? DEFAULT_PATTERNS;
    this.replacement = config.replacement ?? '[REDACTED]';
    this.contentTypes = config.contentTypes ?? ['application/json', 'text/'];
  }

  executeOutbound(ctx: RequestContext, response: OutboundResponse): OutboundResponse | void {
    if (!response.body || response.body.length === 0) return;
    const headerRecord = response.headers as Record<string, unknown>;
    const contentType = String(headerRecord['content-type'] ?? '');
    if (!this.contentTypes.some((type) => contentType.includes(type))) return;

    let text = response.body.toString('utf8');
    let changed = false;
    for (const pattern of this.patterns) {
      const next = text.replace(pattern, this.replacement);
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
    if (!changed) return;

    const body = Buffer.from(text, 'utf8');
    const headers = { ...headerRecord };
    headers['content-length'] = String(body.length);
    headers['x-secret-masked'] = 'true';
    headers['x-masked-request-id'] = ctx.requestId;
    return { statusCode: response.statusCode, headers: headers as OutboundResponse['headers'], body };
  }
}
