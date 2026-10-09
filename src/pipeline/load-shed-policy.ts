import { GatewayPolicy } from './policy.js';
import { RequestContext } from '../types/core.js';
import { HttpProblems } from './http-problems.js';
import { ConcurrencyLimiter } from '../core/concurrency-limiter.js';

export class LoadShedPolicy implements GatewayPolicy {
  readonly name = 'load-shed';
  private readonly limiter: ConcurrencyLimiter;

  constructor(limiter: ConcurrencyLimiter) {
    this.limiter = limiter;
  }

  executeInbound(ctx: RequestContext): Response | void {
    if (!this.limiter.tryAcquire()) {
      return HttpProblems.serviceUnavailable('Server at capacity, retry shortly', {
        requestId: ctx.requestId,
      });
    }
    ctx.state['__loadShedAcquired'] = true;
    ctx.state['__loadShedStart'] = Number(process.hrtime.bigint());
  }

  executeOutbound(ctx: RequestContext): void {
    this.settle(ctx);
  }

  onComplete(ctx: RequestContext): void {
    this.settle(ctx);
  }

  private settle(ctx: RequestContext): void {
    if (!ctx.state['__loadShedAcquired']) return;
    delete ctx.state['__loadShedAcquired'];
    const start = ctx.state['__loadShedStart'] as number | undefined;
    delete ctx.state['__loadShedStart'];
    const latency = start ? Number(process.hrtime.bigint() - BigInt(start)) / 1e6 : 0;
    this.limiter.release(latency);
  }
}
