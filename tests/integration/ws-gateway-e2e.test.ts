import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer as createHttpServer } from 'http';
import { request as httpRequest } from 'http';
import { createHash } from 'crypto';
import { AddressInfo } from 'net';
import { Gateway } from '../../src/index.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Minimal raw WebSocket echo upstream: accepts the handshake, then echoes
 * every unmasked server frame back to the client. No `ws` dependency. */
function createEchoWsUpstream() {
  const server = createHttpServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('echo-ws-upstream');
  });
  const wsSockets = new Set<import('net').Socket>();
  server.on('upgrade', (req, socket) => {
    wsSockets.add(socket);
    socket.on('close', () => wsSockets.delete(socket));
    const key = req.headers['sec-websocket-key'];
    if (!key || typeof key !== 'string') {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.on('data', (buf: Buffer) => {
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let offset = 2;
      if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
      else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); offset = 10; }
      const mask = masked ? buf.subarray(offset, offset + 4) : null;
      offset += masked ? 4 : 0;
      const payload = Buffer.from(buf.subarray(offset, offset + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];

      let header: Buffer;
      if (payload.length < 126) header = Buffer.from([0x80 | opcode, payload.length]);
      else if (payload.length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 126;
        header.writeUInt16BE(payload.length, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(payload.length), 2);
      }
      socket.write(Buffer.concat([header, payload]));
    });
    socket.on('error', () => socket.destroy());
  });
  return { server, wsSockets };
}

describe('WebSocket upgrade tunneling (proxy.enableWebSocket)', () => {
  let gateway: Gateway;
  let port: number;
  let upstream: ReturnType<typeof createEchoWsUpstream>['server'];
  let wsSockets: Set<import('net').Socket>;
  let upstreamPort: number;
  let configPath: string;

  beforeAll(async () => {
    const { server, wsSockets: sockets } = createEchoWsUpstream();
    upstream = server;
    wsSockets = sockets;
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    upstreamPort = (upstream.address() as AddressInfo).port;

    const config = {
      version: '1.0.0',
      environment: 'development',
      server: { port: 3941, host: '127.0.0.1' },
      proxy: { enableWebSocket: true },
      routes: [{ method: 'GET', path: '/ws', priority: 0 }],
      upstreams: [{
        id: 'ws-backend', protocol: 'http', host: '127.0.0.1', port: upstreamPort,
        basePath: '', poolSize: 2, timeout: 30000,
        healthCheck: { enabled: false, interval: 30000, timeout: 5000, path: '/health', expectedStatus: 200 },
      }],
      plugins: [],
      performance: { workerCount: 0, contextPoolSize: 32, bufferPoolSize: 32, responsePoolSize: 32, enablePooling: true },
    };
    configPath = join(tmpdir(), `tsgate-ws-${Date.now()}.json`);
    writeFileSync(configPath, JSON.stringify(config));

    gateway = new Gateway(configPath);
    await gateway.start();
    port = (gateway.getServer()!.getServer().address() as AddressInfo).port;
  }, 20000);

  afterAll(async () => {
    await gateway.stop();
    // Node keeps a detached upgraded socket half-open (FIN from the tunnel
    // teardown); destroy it so upstream.close() can complete.
    for (const s of wsSockets) s.destroy();
    await new Promise<void>(resolve => upstream.close(resolve));
    try { unlinkSync(configPath); } catch {}
  }, 15000);

  it('upgrades and echoes a frame through the gateway tunnel', async () => {
    const result = await new Promise<{ upgraded: boolean; echoed: string | null; status?: number }>(resolve => {
      const key = Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))).toString('base64');
      const req = httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/ws',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': key,
          'Sec-WebSocket-Version': '13',
        },
      });
      req.on('upgrade', (_res, socket) => {
        const payload = Buffer.from('ping');
        const mask = Buffer.from([1, 2, 3, 4]);
        const masked = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
        socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]));
        socket.once('data', buf => {
          const len = buf[1] & 0x7f;
          const echoed = buf.subarray(2, 2 + len).toString();
          socket.destroy();
          resolve({ upgraded: true, echoed });
        });
        setTimeout(() => { socket.destroy(); resolve({ upgraded: true, echoed: null }); }, 1500);
      });
      req.on('response', res => { res.resume(); resolve({ upgraded: false, status: res.statusCode }); });
      req.on('error', e => resolve({ upgraded: false, echoed: null, status: 0 }));
      req.end();
    });

    expect(result.upgraded).toBe(true);
    expect(result.echoed).toBe('ping');
  });
});