import { describe, it, expect } from 'vitest';
import { RecordPolicy } from '../../src/pipeline/record-policy.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function ctx(
  path = '/api/x',
  method = 'GET',
  headers: Record<string, string | string[] | undefined> = {},
  body: Buffer | null = null,
  requestId = 'req-1'
) {
  const c = pool.acquire();
  c.requestId = requestId;
  c.method = method as never;
  c.path = path;
  c.headers = headers;
  c.body = body;
  c.state = {};
  c.responded = false;
  c.res = {} as never;
  return c;
}

function response(body = '{"ok":true}') {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(body),
  };
}

describe('RecordPolicy', () => {
  it('stores a request/response pair after executeOutbound', () => {
    const p = new RecordPolicy({ captureBody: true });
    const c = ctx('/api/x', 'POST', { 'x-a': 'b' }, Buffer.from('{"in":1}'));
    p.executeInbound(c);
    p.executeOutbound(c, response());
    const store = p.getStore();
    expect(store.size()).toBe(1);
    const rec = store.get('req-1');
    expect(rec?.method).toBe('POST');
    expect(rec?.path).toBe('/api/x');
    expect(rec?.requestHeaders['x-a']).toBe('b');
    expect(rec?.requestBody).toBe('{"in":1}');
    expect(rec?.statusCode).toBe(200);
    expect(rec?.responseBody).toBe('{"ok":true}');
    expect(typeof rec?.ts).toBe('number');
  });

  it('stores a null request body when captureBody is false', () => {
    const p = new RecordPolicy({ captureBody: false });
    const c = ctx('/api/x', 'POST', {}, Buffer.from('{"in":1}'));
    p.executeInbound(c);
    p.executeOutbound(c, response());
    expect(p.getStore().get('req-1')?.requestBody).toBeNull();
  });

  it('does not record a method outside methods', () => {
    const p = new RecordPolicy({ methods: ['GET'] });
    const c = ctx('/api/x', 'OPTIONS');
    p.executeInbound(c);
    p.executeOutbound(c, response());
    expect(p.getStore().size()).toBe(0);
  });

  it('executeOutbound with no pending snapshot is a no-op returning undefined', () => {
    const p = new RecordPolicy();
    const c = ctx();
    const out = p.executeOutbound(c, response());
    expect(out).toBeUndefined();
    expect(p.getStore().size()).toBe(0);
  });

  it('skips non-string header values when flattening', () => {
    const p = new RecordPolicy({ captureBody: true });
    const c = ctx('/api/x', 'GET', { 'x-a': ['1', '2'], 'x-b': undefined, 'x-c': 'kept' });
    p.executeInbound(c);
    p.executeOutbound(c, response());
    const rec = p.getStore().get('req-1');
    expect(rec?.requestHeaders['x-a']).toBeUndefined();
    expect(rec?.requestHeaders['x-b']).toBeUndefined();
    expect(rec?.requestHeaders['x-c']).toBe('kept');
  });
});
