import { Router } from '../core/router.js';
import { RequestContext } from '../types/core.js';
import { HttpProblems } from '../pipeline/http-problems.js';

export interface AdminDeps {
  getUptime: () => number;
  getBreakers: () => Record<string, string>;
  getCacheStats: () => Record<string, unknown>;
  getLoadShed?: () => Record<string, unknown>;
  purgeCache: (pattern: RegExp) => number;
  getPolicies: () => string[];
}

export interface AdminConfig {
  basePath?: string;
  requireAuth?: boolean;
  requiredPlan?: string;
}

export class AdminControlPlane {
  private readonly basePath: string;
  private readonly requireAuth: boolean;
  private readonly requiredPlan: string;

  constructor(
    private deps: AdminDeps,
    config: AdminConfig = {}
  ) {
    this.basePath = (config.basePath ?? '/__admin').replace(/\/+$/, '');
    this.requireAuth = config.requireAuth ?? true;
    this.requiredPlan = config.requiredPlan ?? '';
  }

  register(router: Router): void {
    router.register('GET', `${this.basePath}/state`, ctx => this.handleState(ctx));
    router.register('POST', `${this.basePath}/cache/purge`, ctx => this.handlePurge(ctx));
  }

  private authorize(ctx: RequestContext): Response | void {
    if (!this.requireAuth) return;
    const user = ctx.state['user'] as { sub?: string; data?: { plan?: string } } | undefined;
    if (!user?.sub) {
      return HttpProblems.unauthorized('Admin authentication required', {
        requestId: ctx.requestId,
      });
    }
    if (this.requiredPlan && user.data?.plan !== this.requiredPlan) {
      return HttpProblems.forbidden('Insufficient privileges for admin API', {
        requestId: ctx.requestId,
      });
    }
  }

  private async handleState(ctx: RequestContext): Promise<void> {
    const denied = this.authorize(ctx);
    if (denied) return this.write(ctx, denied);
    const body: Record<string, unknown> = {
      uptime: this.deps.getUptime(),
      breakers: this.deps.getBreakers(),
      cache: this.deps.getCacheStats(),
      policies: this.deps.getPolicies(),
    };
    if (this.deps.getLoadShed) body['loadShed'] = this.deps.getLoadShed();
    this.writeJson(ctx, 200, body);
  }

  private async handlePurge(ctx: RequestContext): Promise<void> {
    const denied = this.authorize(ctx);
    if (denied) return this.write(ctx, denied);
    let pattern: string | undefined;
    try {
      const parsed = ctx.body
        ? (JSON.parse(ctx.body.toString('utf8')) as { pattern?: string })
        : {};
      pattern = parsed.pattern;
    } catch {
      return this.write(
        ctx,
        HttpProblems.badRequest('Invalid JSON body', { requestId: ctx.requestId })
      );
    }
    let regex: RegExp;
    try {
      regex = new RegExp(pattern ?? '.*');
    } catch {
      return this.write(
        ctx,
        HttpProblems.badRequest('Invalid pattern', { requestId: ctx.requestId })
      );
    }
    const purged = this.deps.purgeCache(regex);
    this.writeJson(ctx, 200, { purged });
  }

  private writeJson(ctx: RequestContext, status: number, body: unknown): void {
    ctx.res.writeHead(status, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(body));
    ctx.responded = true;
  }

  private async write(ctx: RequestContext, response: Response): Promise<void> {
    ctx.res.statusCode = response.status;
    response.headers.forEach((value, key) => ctx.res.setHeader(key, value));
    ctx.res.end(Buffer.from(await response.arrayBuffer()));
    ctx.responded = true;
  }
}
