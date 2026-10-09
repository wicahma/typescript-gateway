import { describe, it, expect } from 'vitest';
import { StickySessionPolicy } from '../../src/pipeline/sticky-session-policy.js';
import { ContextPool } from '../../src/core/context.js';

const pool = new ContextPool(10);

function ctx(headers: Record<string, string> = {}) {
  const c = pool.acquire();
  c.requestId = 'req-1';
  c.method = 'GET';
  c.path = '/api/x';
  c.headers = headers;
  c.state = {};
  c.responded = false;
  return c;
}

describe('StickySessionPolicy', () => {
  it('assigns the same upstream for the same session key', () => {
    const p = new StickySessionPolicy({ upstreams: ['a', 'b', 'c'] });
    const first = ctx({ 'x-session-id': 'session-1' });
    const second = ctx({ 'x-session-id': 'session-1' });
    p.executeInbound(first);
    p.executeInbound(second);
    expect(first.state['stickyUpstreamId']).toBeDefined();
    expect(second.state['stickyUpstreamId']).toBe(first.state['stickyUpstreamId']);
  });

  it('honors a session id from the Cookie header', () => {
    const p = new StickySessionPolicy({ upstreams: ['a', 'b', 'c'] });
    const c = ctx({ cookie: 'tsgate_sid=abc' });
    p.executeInbound(c);
    expect(c.state['stickyUpstreamId']).toBeDefined();
    expect(p.getSessionCount()).toBe(1);
  });

  it('does nothing when there is no session id', () => {
    const p = new StickySessionPolicy({ upstreams: ['a', 'b', 'c'] });
    const c = ctx();
    p.executeInbound(c);
    expect(c.state['stickyUpstreamId']).toBeUndefined();
    expect(p.getSessionCount()).toBe(0);
  });

  it('maps different keys to potentially different upstreams', () => {
    const p = new StickySessionPolicy({ upstreams: ['a', 'b', 'c'] });
    const ids = new Set<unknown>();
    for (const key of ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']) {
      const c = ctx({ 'x-session-id': key });
      p.executeInbound(c);
      ids.add(c.state['stickyUpstreamId']);
    }
    expect(ids.size).toBeGreaterThanOrEqual(2);
  });

  it('treats expired pins as live-count zero', () => {
    const p = new StickySessionPolicy({ upstreams: ['a', 'b'], ttlMs: -1 });
    const c = ctx({ 'x-session-id': 'expired' });
    p.executeInbound(c);
    expect(c.state['stickyUpstreamId']).toBeDefined();
    expect(p.getSessionCount()).toBe(0);
  });

  it('reset clears all sessions', () => {
    const p = new StickySessionPolicy({ upstreams: ['a', 'b'] });
    p.executeInbound(ctx({ 'x-session-id': 'one' }));
    p.executeInbound(ctx({ 'x-session-id': 'two' }));
    expect(p.getSessionCount()).toBe(2);
    p.reset();
    expect(p.getSessionCount()).toBe(0);
  });

  it('always assigns an id from the configured upstreams', () => {
    const upstreams = ['us-east', 'us-west', 'eu-central'];
    const p = new StickySessionPolicy({ upstreams });
    for (const key of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
      const c = ctx({ 'x-session-id': key });
      p.executeInbound(c);
      expect(upstreams).toContain(c.state['stickyUpstreamId']);
    }
  });
});
