import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import net from 'net';
import crypto from 'crypto';
import { ProxyHandler } from '../../src/core/proxy-handler.js';
import { Router } from '../../src/core/router.js';
import { UpstreamTarget, HttpMethod } from '../../src/types/core.js';

const servers: http.Server[] = [];
afterEach(() => { for (const s of servers) s.close(); servers.length = 0; });

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function startWsUpstream(): Promise<{ target: UpstreamTarget; echoed: string[] }> {
  const echoed: string[] = [];
  return new Promise((resolve) => {
    const server = http.createServer();
    servers.push(server);
    server.on('upgrade', (req, socket, head) => {
      const key = req.headers['sec-websocket-key'] as string;
      const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );
      if (head.length) socket.write(head); // echo head back
      socket.on('data', (d) => { echoed.push(d.toString()); socket.write(d); }); // echo frames
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('no addr');
      resolve({
        echoed,
        target: {
          id: 'ws-upstream', protocol: 'http', host: '127.0.0.1', port: addr.port,
          basePath: '', poolSize: 5, timeout: 5000,
          healthCheck: { enabled: false, interval: 1000, path: '/', timeout: 1000, healthyThreshold: 1, unhealthyThreshold: 1 },
          healthy: true,
          circuitBreaker: { state: 'CLOSED', failures: 0, successes: 0, lastFailure: 0 },
        } as UpstreamTarget,
      });
    });
  });
}

function wsHandshake(port: number, path: string, onUpgraded: (socket: net.Socket, rest: string) => void): void {
  const socket = net.connect(port, '127.0.0.1', () => {
    const key = crypto.randomBytes(16).toString('base64');
    socket.write(
      `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
      `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
    );
  });
  let buf = Buffer.alloc(0);
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    const idx = buf.indexOf('\r\n\r\n');
    if (idx !== -1) {
      const headStr = buf.subarray(0, idx).toString();
      const rest = buf.subarray(idx + 4).toString();
      socket.removeAllListeners('data');
      onUpgraded(socket, headStr + '||' + rest);
    }
  });
}

describe('ProxyHandler WebSocket tunneling', () => {
  it('tunnels a WebSocket upgrade to the matched upstream and echoes data', async () => {
    const { target, echoed } = await startWsUpstream();
    const router = new Router();
    const proxy = new ProxyHandler({ enableWebSocket: true });
    proxy.initialize([target]);
    proxy.setRouter(router);
    router.register('GET' as HttpMethod, '/ws', () => {});

    const server = http.createServer();
    servers.push(server);
    server.on('upgrade', (req, socket, head) => {
      void proxy.tunnelUpgrade(req, socket, head);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;

    const payload = 'PING-THROUGH-GATEWAY';
    await new Promise<void>((resolve, reject) => {
      wsHandshake(port, '/ws', (socket, rest) => {
        try {
          expect(rest).toContain('101');
          socket.on('data', (d) => {
            try {
              expect(d.toString()).toBe(payload);
              socket.destroy();
              resolve();
            } catch (e) { reject(e); }
          });
          socket.write(payload);
        } catch (e) { reject(e); }
      });
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(echoed.join('')).toContain(payload);
  });

  it('rejects upgrade when enableWebSocket is false', async () => {
    const { target } = await startWsUpstream();
    const router = new Router();
    const proxy = new ProxyHandler({ enableWebSocket: false });
    proxy.initialize([target]);
    proxy.setRouter(router);
    router.register('GET' as HttpMethod, '/ws', () => {});

    const fakeSocket = new net.Socket();
    const req = new http.IncomingMessage(fakeSocket);
    req.url = '/ws';
    req.method = 'GET';

    const result = await proxy.tunnelUpgrade(req, fakeSocket, Buffer.alloc(0));
    expect(result).toBe(false);
  });
});
