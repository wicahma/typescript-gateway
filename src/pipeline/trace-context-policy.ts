import { randomBytes } from 'node:crypto';
import { GatewayPolicy } from './policy.js';
import { RequestContext } from '../types/core.js';

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

export class TraceContextPolicy implements GatewayPolicy {
  readonly name = 'trace-context';

  executeInbound(ctx: RequestContext): void {
    const raw = ctx.headers['traceparent'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const match = value ? TRACEPARENT.exec(value) : null;
    const traceId = match ? match[1] : randomBytes(16).toString('hex');
    const parentId = match ? match[2] : randomBytes(8).toString('hex');
    const spanId = randomBytes(8).toString('hex');
    ctx.state['traceId'] = traceId;
    ctx.state['parentSpanId'] = parentId;
    ctx.state['spanId'] = spanId;
    ctx.res.setHeader('traceparent', `00-${traceId}-${spanId}-01`);
  }
}
