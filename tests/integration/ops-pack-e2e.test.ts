import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer as createHttpServer } from 'http';
import { AddressInfo } from 'net';
import { Gateway } from '../../src/index.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('ops pack end-to-end (record + replay + audit)', () => {
  let gateway: Gateway;
  let port: number;
  let upstream: ReturnType<typeof createHttpServer>;
  let upstreamPort: number;
  let configPath: string;
  let upstreamHits = 0;

  beforeAll(async () => {
    upstream = createHttpServer((req, res) => {
      upstreamHits++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ upstream: 'ok' }));
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    upstreamPort = (upstream.address() as AddressInfo).port;

    const config = {
      version: '1.0.0',
      environment: 'development',
      server: { port: 4021, host: '127.0.0.1' },
      record: { enabled: true, captureBody: true },
      replay: { enabled: true },
      audit: { enabled: true },
      routes: [{ method: 'GET', path: '/api/*', priority: 0 }],
      upstreams: [
        {
          id: 'backend',
          protocol: 'http',
          host: '127.0.0.1',
          port: upstreamPort,
          basePath: '',
          poolSize: 10,
          timeout: 30000,
          healthCheck: {
            enabled: false,
            interval: 30000,
            timeout: 5000,
            path: '/health',
            expectedStatus: 200,
          },
        },
      ],
      plugins: [],
      performance: {
        workerCount: 0,
        contextPoolSize: 100,
        bufferPoolSize: 100,
        responsePoolSize: 100,
        enablePooling: true,
      },
    };
    configPath = join(tmpdir(), `tsgate-ops-${Date.now()}.json`);
    writeFileSync(configPath, JSON.stringify(config));

    gateway = new Gateway(configPath);
    await gateway.start();
    port = (gateway.getServer()!.getServer().address() as AddressInfo).port;
  }, 20000);

  afterAll(async () => {
    await gateway.stop();
    upstream.close();
    try {
      unlinkSync(configPath);
    } catch {
      void 0;
    }
  });

  it('records a request then replays it without hitting the upstream', async () => {
    const captured: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      captured.push(String(chunk));
      return true;
    });

    let firstId = '';
    try {
      const first = await fetch(`http://127.0.0.1:${port}/api/data`);
      expect(first.status).toBe(200);
      expect(await first.text()).toBe(JSON.stringify({ upstream: 'ok' }));
    } finally {
      spy.mockRestore();
    }

    for (const line of captured) {
      try {
        const parsed = JSON.parse(line.trim()) as {
          requestId?: string;
          ts?: unknown;
          durationMs?: unknown;
        };
        if (
          typeof parsed.requestId === 'string' &&
          typeof parsed.ts === 'string' &&
          typeof parsed.durationMs === 'number'
        ) {
          firstId = parsed.requestId;
        }
      } catch {
        void 0;
      }
    }
    expect(firstId).not.toBe('');

    const hitsBefore = upstreamHits;
    expect(hitsBefore).toBe(1);

    const replay = await fetch(`http://127.0.0.1:${port}/api/data`, {
      headers: { 'x-replay-id': firstId },
    });
    expect(replay.status).toBe(200);
    expect(replay.headers.get('x-replay')).toBe('hit');
    expect(replay.headers.get('x-replay-id')).toBe(firstId);
    expect(await replay.text()).toBe(JSON.stringify({ upstream: 'ok' }));
    expect(upstreamHits).toBe(hitsBefore);
  }, 20000);

  it('returns a 404 problem for an unknown replay id', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/data`, {
      headers: { 'x-replay-id': 'does-not-exist' },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });
});
