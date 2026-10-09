import { describe, it, expect } from 'vitest';
import { RecordStore, RecordedExchange } from '../../src/pipeline/record-store.js';

function exchange(id: string): RecordedExchange {
  return {
    requestId: id,
    ts: Date.now(),
    method: 'GET',
    path: '/api/x',
    requestHeaders: {},
    requestBody: null,
    statusCode: 200,
    responseHeaders: {},
    responseBody: null,
  };
}

describe('RecordStore', () => {
  it('evicts the oldest entry when over capacity', () => {
    const store = new RecordStore(2);
    store.save(exchange('a'));
    store.save(exchange('b'));
    store.save(exchange('c'));
    expect(store.size()).toBe(2);
    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')?.requestId).toBe('b');
    expect(store.get('c')?.requestId).toBe('c');
  });

  it('gets by id and reports size', () => {
    const store = new RecordStore(10);
    expect(store.size()).toBe(0);
    store.save(exchange('a'));
    expect(store.size()).toBe(1);
    expect(store.get('a')?.requestId).toBe('a');
    expect(store.get('missing')).toBeUndefined();
  });

  it('lists in insertion order', () => {
    const store = new RecordStore(10);
    store.save(exchange('a'));
    store.save(exchange('b'));
    store.save(exchange('c'));
    expect(store.list().map(e => e.requestId)).toEqual(['a', 'b', 'c']);
  });

  it('clear empties the store', () => {
    const store = new RecordStore(10);
    store.save(exchange('a'));
    store.clear();
    expect(store.size()).toBe(0);
    expect(store.list()).toEqual([]);
  });

  it('overwrites an existing id without growing', () => {
    const store = new RecordStore(10);
    store.save(exchange('a'));
    store.save(exchange('a'));
    expect(store.size()).toBe(1);
  });
});
