import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { logger, flushLogs, createLogger } from '../../src/utils/logger.js';
import { resolveAccessLogInterval } from '../../src/core/server.js';

describe('logger buffering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    flushLogs();
  });

  it('buffers 100 log calls into fewer than 100 stdout writes', () => {
    const spy = vi.spyOn(process.stdout, 'write');
    for (let i = 0; i < 100; i++) logger.info({ a: 1 }, 'x');
    expect(spy.mock.calls.length).toBeLessThan(100);
  });

  it('flushLogs writes every buffered line', () => {
    const spy = vi.spyOn(process.stdout, 'write');
    for (let i = 0; i < 100; i++) logger.info({ a: 1 }, 'x');
    flushLogs();
    const text = spy.mock.calls.map(call => String(call[0])).join('');
    expect(text.match(/"msg":"x"/g)?.length).toBe(100);
  });

  it('flushed chunks end with a newline and split into 100 lines', () => {
    const spy = vi.spyOn(process.stdout, 'write');
    for (let i = 0; i < 100; i++) logger.info({ a: 1 }, 'x');
    flushLogs();
    const chunks = spy.mock.calls.map(call => String(call[0]));
    for (const chunk of chunks) expect(chunk.endsWith('\n')).toBe(true);
    const lines = chunks.join('').split('\n').filter(line => line.length > 0);
    expect(lines.length).toBe(100);
  });
});

describe('resolveAccessLogInterval', () => {
  it('maps a sampling rate to a request interval', () => {
    expect(resolveAccessLogInterval(undefined)).toBe(1);
    expect(resolveAccessLogInterval(1)).toBe(1);
    expect(resolveAccessLogInterval(0.5)).toBe(2);
    expect(resolveAccessLogInterval(0.1)).toBe(10);
    expect(resolveAccessLogInterval(0)).toBe(1);
    expect(resolveAccessLogInterval(-1)).toBe(1);
    expect(resolveAccessLogInterval(2)).toBe(1);
  });

  it('a 0.5 rate logs every other request', () => {
    expect(resolveAccessLogInterval(0.5)).toBe(2);
    expect(resolveAccessLogInterval(0.5)).not.toBe(1);
  });
});

describe('logger destination', () => {
  it('a logger without a destination does not inherit the previous one', () => {
    const file = join(tmpdir(), `tsgate-log-${Date.now()}.log`);
    const withDest = createLogger({ destination: file });
    withDest.info({ a: 1 }, 'to-file');
    withDest.flush();
    expect(readFileSync(file, 'utf8')).toContain('to-file');

    const spy = vi.spyOn(process.stdout, 'write');
    const noDest = createLogger({});
    noDest.info({ a: 2 }, 'to-stdout');
    noDest.flush();
    const written = spy.mock.calls.map(call => String(call[0])).join('');
    expect(written).toContain('to-stdout');
    expect(readFileSync(file, 'utf8')).not.toContain('to-stdout');
    spy.mockRestore();
    unlinkSync(file);
  });
});
