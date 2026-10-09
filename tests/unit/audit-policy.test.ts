import { describe, it, expect } from 'vitest';
import { AuditPolicy } from '../../src/pipeline/audit-policy.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function ctx(headers: Record<string, string | string[] | undefined> = {}) {
  const c = pool.acquire();
  c.requestId = 'req-9';
  c.method = 'GET' as never;
  c.path = '/api/data';
  c.headers = headers;
  c.body = null;
  c.state = {};
  c.responded = false;
  c.res = { statusCode: 0 } as never;
  return c;
}

function response(body = '{"ok":true}') {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(body),
  };
}

function collector() {
  const lines: string[] = [];
  return { lines, sink: (line: string) => lines.push(line) };
}

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';

describe('AuditPolicy', () => {
  it('emits exactly one parseable JSON line on inbound+outbound', () => {
    const { lines, sink } = collector();
    const p = new AuditPolicy({ sink });
    const c = ctx();
    p.executeInbound(c);
    p.executeOutbound(c, response());
    expect(lines.length).toBe(1);
    const event = JSON.parse(lines[0] as string) as {
      method: string;
      path: string;
      status: number;
      durationMs: number;
      bytesOut: number;
    };
    expect(event.method).toBe('GET');
    expect(event.path).toBe('/api/data');
    expect(event.status).toBe(200);
    expect(typeof event.durationMs).toBe('number');
    expect(event.bytesOut).toBe(Buffer.from('{"ok":true}').length);
  });

  it('emits exactly one line for a short-circuit (inbound then onComplete)', () => {
    const { lines, sink } = collector();
    const p = new AuditPolicy({ sink });
    const c = ctx();
    c.responded = true;
    c.res = { statusCode: 404 } as never;
    p.executeInbound(c);
    p.onComplete(c);
    expect(lines.length).toBe(1);
    expect((JSON.parse(lines[0] as string) as { status: number }).status).toBe(404);
  });

  it('onComplete after a normal outbound emits nothing extra', () => {
    const { lines, sink } = collector();
    const p = new AuditPolicy({ sink });
    const c = ctx();
    p.executeInbound(c);
    p.executeOutbound(c, response());
    p.onComplete(c);
    expect(lines.length).toBe(1);
  });

  it('onComplete emits status 0 when not responded', () => {
    const { lines, sink } = collector();
    const p = new AuditPolicy({ sink });
    const c = ctx();
    p.onComplete(c);
    expect(lines.length).toBe(1);
    expect((JSON.parse(lines[0] as string) as { status: number }).status).toBe(0);
  });

  it('redacts a JWT-shaped header value when includeHeaders is on', () => {
    const { lines, sink } = collector();
    const p = new AuditPolicy({ sink, includeHeaders: true });
    const c = ctx({ authorization: `Bearer ${JWT}` });
    p.executeInbound(c);
    p.executeOutbound(c, response());
    expect(lines[0]).not.toContain(JWT);
    expect(lines[0]).toContain('[REDACTED]');
  });

  it('honors sampleRate 0 with an injected random', () => {
    const { lines, sink } = collector();
    const p = new AuditPolicy({ sink, sampleRate: 0, random: () => 0.99 });
    const c = ctx();
    p.executeInbound(c);
    p.executeOutbound(c, response());
    expect(lines.length).toBe(0);
  });

  it('records user sub when present', () => {
    const { lines, sink } = collector();
    const p = new AuditPolicy({ sink });
    const c = ctx();
    c.state['user'] = { sub: 'consumer-1' };
    p.executeInbound(c);
    p.executeOutbound(c, response());
    expect((JSON.parse(lines[0] as string) as { user?: string }).user).toBe('consumer-1');
  });
});
