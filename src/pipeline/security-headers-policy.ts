import { GatewayPolicy, OutboundResponse } from './policy.js';
import { RequestContext } from '../types/core.js';

export interface SecurityHeadersConfig {
  contentTypeOptions?: string | false;
  frameOptions?: string | false;
  referrerPolicy?: string | false;
  hsts?: string | false;
  stripServer?: boolean;
  extra?: Record<string, string>;
}

export class SecurityHeadersPolicy implements GatewayPolicy {
  readonly name = 'security-headers';
  private readonly contentTypeOptions: string | false;
  private readonly frameOptions: string | false;
  private readonly referrerPolicy: string | false;
  private readonly hsts: string | false;
  private readonly stripServer: boolean;
  private readonly extra: Record<string, string>;

  constructor(config: SecurityHeadersConfig = {}) {
    this.contentTypeOptions = config.contentTypeOptions ?? 'nosniff';
    this.frameOptions = config.frameOptions ?? 'DENY';
    this.referrerPolicy = config.referrerPolicy ?? 'no-referrer';
    this.hsts = config.hsts ?? false;
    this.stripServer = config.stripServer ?? true;
    this.extra = config.extra ?? {};
  }

  executeOutbound(ctx: RequestContext, response: OutboundResponse): OutboundResponse {
    const headers: Record<string, unknown> = { ...response.headers };

    if (this.stripServer) {
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (lower === 'server' || lower === 'x-powered-by') {
          delete headers[key];
        }
      }
    }

    if (this.contentTypeOptions !== false) {
      headers['x-content-type-options'] = this.contentTypeOptions;
    }
    if (this.frameOptions !== false) {
      headers['x-frame-options'] = this.frameOptions;
    }
    if (this.referrerPolicy !== false) {
      headers['referrer-policy'] = this.referrerPolicy;
    }
    if (typeof this.hsts === 'string' && this.hsts.length > 0) {
      headers['strict-transport-security'] = this.hsts;
    }

    for (const key of Object.keys(this.extra)) {
      headers[key] = this.extra[key];
    }

    return {
      statusCode: response.statusCode,
      headers: headers as OutboundResponse['headers'],
      body: response.body,
    };
  }
}
