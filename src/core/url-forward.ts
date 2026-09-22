import http from 'http';
import https from 'https';
import { UpstreamTarget } from '../types/core.js';
import { HttpClientPool } from './http-client-pool.js';

export interface ForwardRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body?: Buffer | null;
  upstream: UpstreamTarget;
  timeout?: number;
  /**
   * Client disconnect signal. When aborted, the upstream request is
   * destroyed immediately so we stop spending upstream resources on a
   * caller that is already gone.
   */
  signal?: AbortSignal;
}

export interface ForwardResult {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body?: Buffer;
}

export class UrlForwarder {
  private clientPool: HttpClientPool;
  private inflight: Map<string, Promise<ForwardResult>> = new Map();

  constructor(clientPool: HttpClientPool) {
    this.clientPool = clientPool;
  }

  /**
   * Coalescing wrapper: identical idempotent requests (same method + URL)
   * that arrive while one is already in flight share its result instead of
   * each hitting the upstream — collapses cache-miss stampedes to a single
   * upstream fetch. First caller owns the fetch; the rest await the same
   * promise. Only safe for GET/HEAD (responses must be shareable).
   */
  share(request: ForwardRequest): Promise<ForwardResult> {
    const isIdempotent = request.method === 'GET' || request.method === 'HEAD';
    const flightKey = `${request.method} ${request.upstream.id} ${request.upstream.basePath}${request.path}`;
    if (!isIdempotent) return this.forward(request);

    const existing = this.inflight.get(flightKey);
    if (existing) return existing;

    const flight = this.forward(request).finally(() => {
      this.inflight.delete(flightKey);
    });
    this.inflight.set(flightKey, flight);
    return flight;
  }

  async forward(request: ForwardRequest): Promise<ForwardResult> {
    const { method, path, headers, body, upstream, signal } = request;
    const timeout = request.timeout ?? upstream.timeout;

    if (signal?.aborted) {
      throw new Error('Client disconnected before upstream request');
    }

    return new Promise((resolve, reject) => {
      this.clientPool
        .acquire(upstream)
        .then((agent) => {
          const client = upstream.protocol === 'https' ? https : http;
          const options: http.RequestOptions = {
            hostname: upstream.host,
            port: upstream.port,
            path: upstream.basePath + path,
            method,
            headers: { ...headers },
            agent,
            timeout,
          };

          if (body) {
            const outHeaders = options.headers as http.OutgoingHttpHeaders;
            outHeaders['content-length'] = body.length;
          }

          const onAbort = (): void => {
            proxyReq.destroy();
            this.clientPool.remove(upstream, agent);
            reject(new Error('Client disconnected during upstream request'));
          };

          const proxyReq = client.request(options, (proxyRes) => {
            const chunks: Buffer[] = [];

            proxyRes.on('data', (chunk: Buffer) => {
              chunks.push(chunk);
            });

            proxyRes.on('end', () => {
              this.clientPool.release(upstream, agent);
              resolve({
                statusCode: proxyRes.statusCode || 500,
                headers: proxyRes.headers,
                body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
              });
            });

            proxyRes.on('error', (error) => {
              this.clientPool.remove(upstream, agent);
              reject(error);
            });
          });

          proxyReq.on('error', (error) => {
            this.clientPool.remove(upstream, agent);
            reject(error);
          });

          proxyReq.on('timeout', () => {
            proxyReq.destroy();
            this.clientPool.remove(upstream, agent);
            reject(new Error('Upstream request timeout'));
          });

          if (body) {
            proxyReq.write(body);
          }

          proxyReq.end();
          signal?.addEventListener('abort', onAbort, { once: true });
        })
        .catch(reject);
    });
  }
}