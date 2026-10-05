/**
 * B1 regression: config hot reload (fs.watch + reloadInterval + interpolate).
 * Rewriting the config file must retarget the proxy to the new upstream
 * WITHOUT restarting the listening socket.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { Gateway } from '../../src/index.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function upstreamServer(tag: string) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ upstream: tag }));
  });
  return server;
}

function makeConfig(port: number, upstreamPort: number, hotReload: boolean) {
  return {
    version: '1.0.0',
    environment: 'development',
    server: { port, host: '127.0.0.1' },
    hotReload,
    reloadInterval: 50,
    routes: [{ method: 'GET', path: '/api/*', priority: 0 }],
    upstreams: [{
      id: 'backend', protocol: 'http', host: '127.0.0.1', port: upstreamPort,
      basePath: '', poolSize: 1, timeout: 30000,
      healthCheck: { enabled: false, interval: 30000, timeout: 5000, path: '/health', expectedStatus: 200 },
    }],
    plugins: [],
    performance: { workerCount: 0, contextPoolSize: 100, bufferPoolSize: 100, responsePoolSize: 100, enablePooling: true },
  };
}

async function listen(server: ReturnType<typeof upstreamServer>): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

describe('B1 config hot reload (in-process gateway)', () => {
  let gateway: Gateway;
  let upstreamA: ReturnType<typeof upstreamServer>;
  let upstreamB: ReturnType<typeof upstreamServer>;
  let portA: number;
  let portB: number;
  let gatewayPort: number;
  let configPath: string;
  let serverInstance: object;

  beforeAll(async () => {
    upstreamA = upstreamServer('a');
    upstreamB = upstreamServer('b');
    portA = await listen(upstreamA);
    portB = await listen(upstreamB);

    configPath = join(tmpdir(), `tsgate-b1-${Date.now()}.json`);
    writeFileSync(configPath, JSON.stringify(makeConfig(3996, portA, true)));

    gateway = new Gateway(configPath);
    await gateway.start();
    gatewayPort = (gateway.getServer()!.getServer().address() as AddressInfo).port;
    serverInstance = gateway.getServer();
  }, 20000);

  afterAll(async () => {
    await gateway.stop();
    upstreamA.close();
    upstreamB.close();
    try { unlinkSync(configPath); } catch {}
  });

  it('retargets to the new upstream on config rewrite without restarting the socket', async () => {
    // Initial state: requests go to upstream A.
    const before = await fetch(`http://127.0.0.1:${gatewayPort}/api/x`).then(r => r.json());
    expect(before).toEqual({ upstream: 'a' });

    // Rewrite the config to point at upstream B.
    writeFileSync(configPath, JSON.stringify(makeConfig(3996, portB, true)));

    // Poll until the gateway picks up the change (debounce 50ms).
    let got: { upstream?: string } | null = null;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const res = await fetch(`http://127.0.0.1:${gatewayPort}/api/x`);
      got = (await res.json()) as { upstream?: string };
      if (got && got.upstream === 'b') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    expect(got && got.upstream).toBe('b');
    // Same Server instance: the socket was never restarted.
    expect(gateway.getServer()).toBe(serverInstance);
  }, 20000);
});
