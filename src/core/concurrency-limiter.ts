export interface ConcurrencyLimiterOptions {
  min: number;
  max: number;
  targetP95Ms?: number;
  minSamples?: number;
}

export class ConcurrencyLimiter {
  private readonly min: number;
  private readonly max: number;
  private readonly targetP95Ms: number;
  private readonly minSamples: number;
  private limit: number;
  private inflight = 0;
  private readonly samples: Array<{ at: number; latency: number }> = [];

  constructor(options: ConcurrencyLimiterOptions) {
    this.min = Math.max(1, options.min);
    this.max = Math.max(this.min, options.max);
    this.targetP95Ms = options.targetP95Ms ?? 250;
    this.minSamples = options.minSamples ?? 20;
    this.limit = this.max;
  }

  tryAcquire(): boolean {
    if (this.inflight >= this.limit) return false;
    this.inflight++;
    return true;
  }

  release(latencyMs: number): void {
    this.inflight = Math.max(0, this.inflight - 1);
    const now = Date.now();
    this.samples.push({ at: now, latency: latencyMs });
    while (this.samples.length > 0 && now - this.samples[0].at > 1000) this.samples.shift();
    if (this.samples.length < this.minSamples) return;
    const sorted = this.samples.map((s) => s.latency).sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    if (p95 > this.targetP95Ms) this.limit = Math.max(this.min, Math.floor(this.limit * 0.9));
    else this.limit = Math.min(this.max, this.limit + 1);
  }

  currentLimit(): number {
    return this.limit;
  }

  inFlight(): number {
    return this.inflight;
  }
}
