/**
 * Distributed Tracing Foundation - OpenTelemetry-compatible
 * Phase 8: Monitoring & Observability
 * 
 * Features:
 * - W3C Trace Context propagation
 * - Span creation and management
 * - Trace ID generation and propagation
 * - Configurable sampling
 * - Export interface for trace backends
 * 
 * Performance target: < 0.05ms overhead per request (at 1% sampling)
 */

import { logger } from '../utils/logger.js';
import { randomBytes } from 'crypto';

/**
 * Span kind
 */
export enum SpanKind {
  INTERNAL = 'INTERNAL',
  SERVER = 'SERVER',
  CLIENT = 'CLIENT',
  PRODUCER = 'PRODUCER',
  CONSUMER = 'CONSUMER',
}

/**
 * Span status
 */
export enum SpanStatus {
  UNSET = 'UNSET',
  OK = 'OK',
  ERROR = 'ERROR',
}

/**
 * Span attributes
 */
export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

/**
 * Span event
 */
export interface SpanEvent {
  /** Event name */
  name: string;
  /** Event timestamp in milliseconds */
  timestamp: number;
  /** Event attributes */
  attributes?: SpanAttributes;
}

/**
 * Span data
 */
export interface Span {
  /** Trace ID (32-character hex) */
  traceId: string;
  /** Span ID (16-character hex) */
  spanId: string;
  /** Parent span ID (if any) */
  parentSpanId?: string;
  /** Span name */
  name: string;
  /** Span kind */
  kind: SpanKind;
  /** Start timestamp in milliseconds */
  startTime: number;
  /** End timestamp in milliseconds */
  endTime?: number;
  /** Span duration in milliseconds */
  duration?: number;
  /** Span status */
  status: SpanStatus;
  /** Status message (for errors) */
  statusMessage?: string;
  /** Span attributes */
  attributes: SpanAttributes;
  /** Span events */
  events: SpanEvent[];
}

/**
 * Trace context
 */
export interface TraceContext {
  /** Trace ID */
  traceId: string;
  /** Parent span ID */
  parentSpanId: string;
  /** Trace flags (01 = sampled) */
  traceFlags: string;
}

/**
 * Sampling decision
 */
export interface SamplingDecision {
  /** Whether to sample */
  sampled: boolean;
  /** Reason for sampling decision */
  reason: string;
}

/**
 * Tracer configuration
 */
export interface TracerConfig {
  /** Enable tracing */
  enabled: boolean;
  /** Sampling rate (0.0 to 1.0) */
  samplingRate: number;
  /** Export interval in milliseconds */
  exportInterval: number;
  /** Maximum spans to buffer before export */
  maxSpansInBuffer: number;
  /** Service name for tracing */
  serviceName?: string;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: TracerConfig = {
  enabled: true,
  samplingRate: 0.01, // 1% sampling
  exportInterval: 5000, // 5 seconds
  maxSpansInBuffer: 1000,
  serviceName: 'typescript-gateway',
};

/**
 * Tracer
 */
export class Tracer {
  private config: TracerConfig;
  private spanBuffer: Span[] = [];
  private activeSpans: Map<string, Span> = new Map();
  private exportTimer?: NodeJS.Timeout;
  private exportHandlers: Array<(spans: Span[]) => Promise<void>> = [];
  
  // Statistics
  private totalSpans = 0;
  private sampledSpans = 0;
  private droppedSpans = 0;

  constructor(config?: Partial<TracerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    if (this.config.enabled) {
      this.startExportTimer();
    }
  }

  /**
   * Parse W3C Trace Context from header
   */
  parseTraceContext(traceparent?: string): TraceContext | null {
    if (!traceparent) return null;

    // W3C Trace Context format: version-traceId-parentId-traceFlags
    // Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
    const parts = traceparent.split('-');
    if (parts.length !== 4) return null;

    const [version, traceId, parentSpanId, traceFlags] = parts;

    // Validate version
    if (version !== '00') return null;

    // Validate trace ID (32 hex chars)
    if (!traceId || traceId.length !== 32 || !/^[0-9a-f]{32}$/.test(traceId)) {
      return null;
    }

    // Validate parent span ID (16 hex chars)
    if (!parentSpanId || parentSpanId.length !== 16 || !/^[0-9a-f]{16}$/.test(parentSpanId)) {
      return null;
    }

    // Validate trace flags (2 hex chars)
    if (!traceFlags || traceFlags.length !== 2 || !/^[0-9a-f]{2}$/.test(traceFlags)) {
      return null;
    }

    return {
      traceId,
      parentSpanId,
      traceFlags,
    };
  }

  /**
   * Generate W3C Trace Context header
   */
  generateTraceContext(span: Span, sampled: boolean = true): string {
    const version = '00';
    const traceFlags = sampled ? '01' : '00';
    return `${version}-${span.traceId}-${span.spanId}-${traceFlags}`;
  }

  /**
   * Make sampling decision
   */
  shouldSample(traceContext?: TraceContext): SamplingDecision {
    if (!this.config.enabled) {
      return { sampled: false, reason: 'tracing_disabled' };
    }

    // If parent trace is sampled, sample this span too
    if (traceContext?.traceFlags === '01') {
      return { sampled: true, reason: 'parent_sampled' };
    }

    // Random sampling based on rate
    const random = Math.random();
    const sampled = random < this.config.samplingRate;
    
    return {
      sampled,
      reason: sampled ? 'sampled' : 'not_sampled',
    };
  }

  /**
   * Start a new span
   */
  startSpan(
    name: string,
    kind: SpanKind = SpanKind.INTERNAL,
    traceContext?: TraceContext,
    attributes?: SpanAttributes
  ): Span | null {
    this.totalSpans++;

    // Make sampling decision
    const samplingDecision = this.shouldSample(traceContext);
    if (!samplingDecision.sampled) {
      return null; // Don't create span if not sampled
    }

    this.sampledSpans++;

    const traceId = traceContext?.traceId || this.generateTraceId();
    const spanId = this.generateSpanId();

    const span: Span = {
      traceId,
      spanId,
      parentSpanId: traceContext?.parentSpanId,
      name,
      kind,
      startTime: Date.now(),
      status: SpanStatus.UNSET,
      attributes: {
        'service.name': this.config.serviceName || 'typescript-gateway',
        ...attributes,
      },
      events: [],
    };

    this.activeSpans.set(spanId, span);
    return span;
  }

  /**
   * End a span
   */
  endSpan(span: Span, status: SpanStatus = SpanStatus.OK, statusMessage?: string): void {
    if (!span) return;

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
    span.statusMessage = statusMessage;

    // Remove from active spans
    this.activeSpans.delete(span.spanId);

    // Add to buffer
    if (this.spanBuffer.length < this.config.maxSpansInBuffer) {
      this.spanBuffer.push(span);
    } else {
      this.droppedSpans++;
      logger.warn(`Span buffer full, dropping span: ${span.name}`);
    }

    // Export immediately if buffer is full
    if (this.spanBuffer.length >= this.config.maxSpansInBuffer) {
      this.exportSpans();
    }
  }

  /**
   * Add event to span
   */
  addSpanEvent(span: Span, name: string, attributes?: SpanAttributes): void {
    if (!span) return;

    span.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
  }

  /**
   * Set span attributes
   */
  setSpanAttributes(span: Span, attributes: SpanAttributes): void {
    if (!span) return;

    span.attributes = {
      ...span.attributes,
      ...attributes,
    };
  }

  /**
   * Set span status
   */
  setSpanStatus(span: Span, status: SpanStatus, message?: string): void {
    if (!span) return;

    span.status = status;
    span.statusMessage = message;
  }

  /**
   * Record exception in span
   */
  recordException(span: Span, error: Error): void {
    if (!span) return;

    this.addSpanEvent(span, 'exception', {
      'exception.type': error.name,
      'exception.message': error.message,
      'exception.stacktrace': error.stack,
    });

    this.setSpanStatus(span, SpanStatus.ERROR, error.message);
  }

  /**
   * Add export handler
   */
  addExportHandler(handler: (spans: Span[]) => Promise<void>): void {
    this.exportHandlers.push(handler);
  }

  /**
   * Export spans to backends
   */
  private async exportSpans(): Promise<void> {
    if (this.spanBuffer.length === 0) return;

    const spans = [...this.spanBuffer];
    this.spanBuffer = [];

    // Export to all registered handlers
    for (const handler of this.exportHandlers) {
      try {
        await handler(spans);
      } catch (error) {
        logger.error(`Span export failed: ${error}`);
      }
    }
  }

  /**
   * Start export timer
   */
  private startExportTimer(): void {
    this.exportTimer = setInterval(() => {
      this.exportSpans();
    }, this.config.exportInterval);

    logger.info('Tracer export timer started');
  }

  /**
   * Stop export timer
   */
  private stopExportTimer(): void {
    if (this.exportTimer) {
      clearInterval(this.exportTimer);
      this.exportTimer = undefined;
    }
  }

  /**
   * Flush all pending spans
   */
  async flush(): Promise<void> {
    await this.exportSpans();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TracerConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart timer if export interval changed
    if (config.exportInterval !== undefined) {
      this.stopExportTimer();
      if (this.config.enabled) {
        this.startExportTimer();
      }
    }
  }

  /**
   * Get tracer statistics
   */
  getStats(): {
    totalSpans: number;
    sampledSpans: number;
    droppedSpans: number;
    bufferSize: number;
    activeSpans: number;
    samplingRate: number;
  } {
    return {
      totalSpans: this.totalSpans,
      sampledSpans: this.sampledSpans,
      droppedSpans: this.droppedSpans,
      bufferSize: this.spanBuffer.length,
      activeSpans: this.activeSpans.size,
      samplingRate: this.config.samplingRate,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.totalSpans = 0;
    this.sampledSpans = 0;
    this.droppedSpans = 0;
  }

  /**
   * Generate trace ID (32 hex characters)
   */
  private generateTraceId(): string {
    return randomBytes(16).toString('hex');
  }

  /**
   * Generate span ID (16 hex characters)
   */
  private generateSpanId(): string {
    return randomBytes(8).toString('hex');
  }

  /**
   * Shutdown tracer
   */
  async shutdown(): Promise<void> {
    this.stopExportTimer();
    await this.flush();
    this.spanBuffer = [];
    this.activeSpans.clear();
    logger.info('Tracer shutdown complete');
  }
}
