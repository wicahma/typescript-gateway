export interface RecordedExchange {
  requestId: string;
  ts: number;
  method: string;
  path: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  statusCode: number;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
}

export class RecordStore {
  private readonly maxEntries: number;
  private readonly entries = new Map<string, RecordedExchange>();

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  save(exchange: RecordedExchange): void {
    if (this.entries.has(exchange.requestId)) {
      this.entries.delete(exchange.requestId);
    }
    this.entries.set(exchange.requestId, exchange);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get(id: string): RecordedExchange | undefined {
    return this.entries.get(id);
  }

  size(): number {
    return this.entries.size;
  }

  list(): RecordedExchange[] {
    return [...this.entries.values()];
  }

  clear(): void {
    this.entries.clear();
  }
}
