import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import { UrlForwarder } from '../../src/core/url-forward';
import { HttpClientPool } from '../../src/core/http-client-pool';
import { UpstreamTarget } from '../../src/types/core';

const servers: http.Server[] = [];
afterEach(() => { for (const s of servers) s.close(); servers.length = 0; });

function startUpstream(handler: http.RequestListener): Promise<UpstreamTarget> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('no addr');
      resolve({
        id: 'stream-upstream', protocol: 'http', host: '127.0.0.1', port: addr.port,
        basePath: '', poolSize: 5, timeout: 5000,
        healthCheck: { enabled: false, interval: 1000, path: '/', timeout: 1000, healthyThreshold: 1, unhealthyThreshold: 1 },
        healthy: true,
        circuitBreaker: { state: 'CLOSED', failures: 0, successes: 0, lastFailure: 0 },
      } as UpstreamTarget);
    });
  });
}

describe('UrlForwarder.forwardStreaming', () => {
  it('delivers headers + body without buffering the whole response', async () => {
    const big = 'x'.repeat(512 * 1024);
    const upstream = await startUpstream((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': String(big.length) });
      res.end(big);
    });
    const forwarder = new UrlForwarder(new HttpClientPool());

    let headersSeen = false;
    let bodyLen = 0;
    await forwarder.forwardStreaming(
      { method: 'GET', path: '/big', headers: {}, upstream, timeout: 5000 },
      (res) => {
        headersSeen = true;
        res.on('data', (c: Buffer) => { bodyLen += c.length; });
      }
    );

    expect(headersSeen).toBe(true);
    expect(bodyLen).toBe(big.length);
  });

  it('aborts the stream when the client disconnects', async () => {
    const upstream = await startUpstream((req, res) => {
      res.writeHead(200, { 'transfer-encoding': 'chunked' });
      res.write('chunk-');
      // never end
    });
    const forwarder = new UrlForwarder(new HttpClientPool());
    const ac = new AbortController();

    const pending = forwarder.forwardStreaming(
      { method: 'GET', path: '/never-ends', headers: {}, upstream, timeout: 10000, signal: ac.signal },
      () => {}
    );

    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await expect(pending).rejects.toThrow(/client disconnected/i);
  });
});
