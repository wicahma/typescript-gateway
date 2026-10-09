import { describe, it, expect } from 'vitest';
import { ReplayPolicy } from '../../src/pipeline/replay-policy.js';
import { RecordStore } from '../../src/pipeline/record-store.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function ctx(headers: Record<string, string | string[] | undefined> = {}) {
  const c = pool.acquire();
  c.requestId = 'req-2';
  c.method = 'GET' as never;
  c.path = '/api/x';
  c.headers = headers;
  c.body = null;
  c.state = {};
  c.responded = false;
  c.res = {} as never;
  return c;
}

function seeded(store: RecordStore, id: string, ts = Date.now()) {
  store.save({
    requestId: id,
    ts,
    method: 'GET',
    path: '/api/data',
    requestHeaders: {},
    requestBody: null,
    statusCode: 201,
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: '{"replayed":true}',
  });
}

describe('ReplayPolicy', () => {
  it('returns undefined when no header is present', () => {
    const store = new RecordStore();
    const p = new ReplayPolicy({ store });
    expect(p.executeInbound(ctx())).toBeUndefined();
  });

  it('returns a Response with recorded status, body and x-replay: hit', async () => {
    const store = new RecordStore();
    seeded(store, 'r1');
    const p = new ReplayPolicy({ store });
    const out = p.executeInbound(ctx({ 'x-replay-id': 'r1' }));
    expect(out).toBeInstanceOf(Response);
    const res = out as Response;
    expect(res.status).toBe(201);
    expect(res.headers.get('x-replay')).toBe('hit');
    expect(res.headers.get('x-replay-id')).toBe('r1');
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.text()).toBe('{"replayed":true}');
  });

  it('defaults content-type to application/json when not recorded', async () => {
    const store = new RecordStore();
    store.save({
      requestId: 'r1',
      ts: Date.now(),
      method: 'GET',
      path: '/api/data',
      requestHeaders: {},
      requestBody: null,
      statusCode: 200,
      responseHeaders: {},
      responseBody: 'plain',
    });
    const p = new ReplayPolicy({ store });
    const res = p.executeInbound(ctx({ 'x-replay-id': 'r1' })) as Response;
    expect(res.headers.get('content-type')).toBe('application/json');
  });

  it('returns a 404 problem+json for an unknown id', async () => {
    const store = new RecordStore();
    const p = new ReplayPolicy({ store });
    const res = p.executeInbound(ctx({ 'x-replay-id': 'nope' })) as Response;
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const body = (await res.json()) as { status: number };
    expect(body.status).toBe(404);
  });

  it('returns a 409 when the record is older than maxAgeMs', () => {
    const store = new RecordStore();
    seeded(store, 'r1', Date.now() - 10_000);
    const p = new ReplayPolicy({ store, maxAgeMs: 1000 });
    const res = p.executeInbound(ctx({ 'x-replay-id': 'r1' })) as Response;
    expect(res.status).toBe(409);
  });

  it('replays a record within maxAgeMs', () => {
    const store = new RecordStore();
    seeded(store, 'r1', Date.now() - 100);
    const p = new ReplayPolicy({ store, maxAgeMs: 60_000 });
    const res = p.executeInbound(ctx({ 'x-replay-id': 'r1' })) as Response;
    expect(res.status).toBe(201);
  });
});
