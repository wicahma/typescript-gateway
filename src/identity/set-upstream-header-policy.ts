import { RequestContext } from '../types/core.js';
import { GatewayPolicy } from '../pipeline/policy.js';
import { HttpProblems } from '../pipeline/http-problems.js';
import { UpstreamCredentialStore } from './upstream-credential-store.js';

export interface SetUpstreamHeaderPolicyConfig {
  credentialName: string;
  publicRoutes?: string[];
}

const SENSITIVE_HEADERS = ['authorization', 'cookie'];

export class SetUpStreamHeaderPolicy implements GatewayPolicy {
  readonly name = 'set-upstream-header';

  private readonly publicRoutes: Set<string>;

  constructor(
    private store: UpstreamCredentialStore,
    private config: SetUpstreamHeaderPolicyConfig,
  ) {
    this.publicRoutes = new Set(config.publicRoutes ?? ['/', '/health', '/metrics']);
  }

  executeInbound(ctx: RequestContext): Response | void {
    if (this.publicRoutes.has(ctx.path)) return;

    if (!ctx.state['user']) {
      return HttpProblems.unauthorized('Caller authentication required before upstream injection.');
    }

    const headers = this.store.resolveHeaderValues(this.config.credentialName);
    if (!headers) {
      return HttpProblems.internal('Upstream credential not configured.');
    }

    const targets = new Set(Object.keys(headers).map((k) => k.toLowerCase()));
    for (const key of Object.keys(ctx.headers)) {
      const lower = key.toLowerCase();
      if (SENSITIVE_HEADERS.includes(lower) || targets.has(lower)) {
        delete ctx.headers[key];
      }
    }

    for (const [name, value] of Object.entries(headers)) {
      ctx.headers[name.toLowerCase()] = value;
    }

    ctx.state['upstreamCredential'] = this.config.credentialName;
  }
}
