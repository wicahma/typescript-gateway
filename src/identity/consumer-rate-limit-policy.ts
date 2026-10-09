import { GatewayPolicy } from '../pipeline/policy.js';
import { RequestContext } from '../types/core.js';
import { HttpProblems } from '../pipeline/http-problems.js';
import { TokenBucketRateLimiter } from '../core/rate-limiter.js';

export interface ConsumerRateLimitPolicyConfig {
  maxBuckets?: number;
}

interface ConsumerIdentity {
  sub: string;
  data: { plan: string; rateLimit: number; dailyLimit?: number };
}

interface DailyCounter {
  count: number;
  resetAt: number;
}

const DAY_MS = 86_400_000;

export class ConsumerRateLimitPolicy implements GatewayPolicy {
  readonly name = 'consumer-rate-limit';

  private buckets = new Map<string, { limiter: TokenBucketRateLimiter; capacity: number }>();
  private daily = new Map<string, DailyCounter>();

  constructor(private config: ConsumerRateLimitPolicyConfig = {}) {}

  executeInbound(ctx: RequestContext): Response | void {
    const user = ctx.state['user'] as ConsumerIdentity | undefined;
    if (!user?.sub) return;

    const rateLimit = user.data?.rateLimit;
    if (typeof rateLimit !== 'number' || rateLimit <= 0) return;

    let entry = this.buckets.get(user.sub);
    if (!entry || entry.capacity !== rateLimit) {
      entry = {
        limiter: new TokenBucketRateLimiter({
          capacity: rateLimit,
          refillRate: rateLimit / 60,
          maxBuckets: this.config.maxBuckets ?? 100000,
        }),
        capacity: rateLimit,
      };
      this.buckets.set(user.sub, entry);
    }

    const result = entry.limiter.consume(user.sub);
    ctx.res.setHeader('X-RateLimit-Limit', String(result.limit));
    ctx.res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      const problem = HttpProblems.rateLimited({
        limit: result.limit,
        window: 'minute',
        retryAfterSeconds: Math.ceil(result.retryAfter ?? 1),
        requestId: ctx.requestId,
      });
      problem.headers.set('x-ratelimit-limit', String(result.limit));
      problem.headers.set('x-ratelimit-remaining', String(result.remaining));
      return problem;
    }

    const dailyLimit = user.data?.dailyLimit;
    if (typeof dailyLimit === 'number' && dailyLimit > 0) {
      const counter = this.dailyCounter(user.sub);
      counter.count++;
      const remaining = Math.max(0, dailyLimit - counter.count);
      ctx.res.setHeader('X-RateLimit-Daily-Limit', String(dailyLimit));
      ctx.res.setHeader('X-RateLimit-Daily-Remaining', String(remaining));
      if (counter.count > dailyLimit) {
        const retryAfter = Math.max(1, Math.ceil((counter.resetAt - Date.now()) / 1000));
        const problem = HttpProblems.rateLimited({
          detail: `Daily quota of ${dailyLimit} requests exceeded.`,
          limit: dailyLimit,
          window: 'day',
          retryAfterSeconds: retryAfter,
          requestId: ctx.requestId,
        });
        problem.headers.set('x-ratelimit-daily-limit', String(dailyLimit));
        problem.headers.set('x-ratelimit-daily-remaining', '0');
        return problem;
      }
    }
  }

  private dailyCounter(sub: string): DailyCounter {
    const now = Date.now();
    let counter = this.daily.get(sub);
    if (!counter || counter.resetAt <= now) {
      counter = { count: 0, resetAt: now + DAY_MS };
      this.daily.set(sub, counter);
    }
    return counter;
  }
}
