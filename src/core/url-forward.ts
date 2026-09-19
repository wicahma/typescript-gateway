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
}

export interface ForwardResult {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body?: Buffer;
}

export class UrlForwarder {
  private clientPool: HttpClientPool;

  constructor(clientPool: HttpClientPool) {
    this.clientPool = clientPool;
  }

  async forward(request: ForwardRequest): Promise<ForwardResult> {
    const { method, path, headers, body, upstream } = request;
    const timeout = request.timeout ?? upstream.timeout;

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
        })
        .catch(reject);
    });
  }
}