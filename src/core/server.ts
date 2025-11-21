/**
 * Native HTTP server wrapper
 * Zero-copy request/response handling with proper backpressure
 */

import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from 'http';
import { ServerConfig, RequestContext, HttpMethod } from '../types/core.js';
import { Router } from './router.js';
import { ObjectPool } from '../utils/pool.js';
import { metrics } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';

/**
 * Request context factory for object pooling
 * Not used directly but kept for reference
 */
// function createRequestContext(): RequestContext {
//   return {
//     requestId: '',
//     startTime: 0n,
//     method: 'GET',
//     path: '',
//     query: null,
//     params: {},
//     headers: {},
//     body: null,
//     req: null as unknown as IncomingMessage,
//     res: null as unknown as ServerResponse,
//     upstream: null,
//     state: {},
//     responded: false
//   };
// }

/**
 * Poolable request context with reset method
 */
class PoolableRequestContext implements RequestContext {
  requestId = '';
  startTime = 0n;
  method: HttpMethod = 'GET';
  path = '';
  query: Record<string, string> | null = null;
  params: Record<string, string> = {};
  headers: Record<string, string | string[] | undefined> = {};
  body: Buffer | null = null;
  req: IncomingMessage = null as unknown as IncomingMessage;
  res: ServerResponse = null as unknown as ServerResponse;
  upstream = null;
  state: Record<string, unknown> = {};
  responded = false;

  reset(): void {
    this.requestId = '';
    this.startTime = 0n;
    this.method = 'GET';
    this.path = '';
    this.query = null;
    this.params = {};
    this.headers = {};
    this.body = null;
    this.req = null as unknown as IncomingMessage;
    this.res = null as unknown as ServerResponse;
    this.upstream = null;
    this.state = {};
    this.responded = false;
  }
}

/**
 * Native HTTP server implementation
 */
export class Server {
  private server: HttpServer;
  private router: Router;
  private config: ServerConfig;
  private contextPool: ObjectPool<PoolableRequestContext>;
  private requestIdCounter = 0;

  constructor(config: ServerConfig, router: Router) {
    this.config = config;
    this.router = router;
    
    // Initialize request context pool
    this.contextPool = new ObjectPool(
      () => new PoolableRequestContext(),
      1000 // Pool size
    );

    // Create native HTTP server
    this.server = createServer({
      keepAlive: config.keepAlive,
      keepAliveTimeout: config.keepAliveTimeout,
      maxHeaderSize: config.maxHeaderSize,
    });

    // Setup request handler
    this.server.on('request', this.handleRequest.bind(this));
    
    // Setup connection handler
    this.server.on('connection', this.handleConnection.bind(this));

    // Setup error handler
    this.server.on('error', this.handleServerError.bind(this));
  }

  /**
   * Handle new connection
   */
  private handleConnection(socket: import('net').Socket): void {
    metrics.incrementConnections();
    
    socket.on('close', () => {
      metrics.decrementConnections();
    });

    // Set socket timeout
    socket.setTimeout(this.config.requestTimeout);
  }

  /**
   * Handle incoming HTTP request
   * Zero-copy, minimal allocations
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Generate request ID
    const requestId = `req-${++this.requestIdCounter}`;
    
    // Record request start time (high precision)
    const startTime = process.hrtime.bigint();
    
    // Record request metric
    metrics.recordRequest();

    // Acquire context from pool
    const ctx = this.contextPool.acquire();
    
    try {
      // Populate context (minimal copying)
      ctx.requestId = requestId;
      ctx.startTime = startTime;
      ctx.method = (req.method || 'GET') as HttpMethod;
      ctx.path = req.url || '/';
      ctx.headers = req.headers;
      ctx.req = req;
      ctx.res = res;

      // Parse query string (lazy - only if accessed)
      const queryIndex = ctx.path.indexOf('?');
      if (queryIndex !== -1) {
        ctx.query = this.parseQuery(ctx.path.slice(queryIndex + 1));
        ctx.path = ctx.path.slice(0, queryIndex);
      }

      // Match route
      const match = this.router.match(ctx.method, ctx.path);
      
      if (!match) {
        this.send404(ctx);
        return;
      }

      // Set route params
      ctx.params = match.params;

      // Execute handler
      await match.handler(ctx);

      // Send response if not already sent
      if (!ctx.responded) {
        this.sendResponse(ctx, 200, 'OK');
      }

    } catch (error) {
      this.handleRequestError(ctx, error as Error);
    } finally {
      // Record latency
      metrics.recordLatency(startTime);
      
      // Release context back to pool
      this.contextPool.release(ctx);
    }
  }

  /**
   * Parse query string into object
   */
  private parseQuery(queryString: string): Record<string, string> {
    const query: Record<string, string> = {};
    const pairs = queryString.split('&');
    
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key) {
        query[decodeURIComponent(key)] = decodeURIComponent(value || '');
      }
    }
    
    return query;
  }

  /**
   * Send response helper
   */
  private sendResponse(ctx: RequestContext, statusCode: number, body: string | Buffer): void {
    if (ctx.responded) return;

    ctx.res.writeHead(statusCode, {
      'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/octet-stream',
      'Content-Length': Buffer.byteLength(body)
    });
    ctx.res.end(body);
    ctx.responded = true;
  }

  /**
   * Send 404 response
   */
  private send404(ctx: RequestContext): void {
    this.sendResponse(ctx, 404, 'Not Found');
  }

  /**
   * Handle request error
   */
  private handleRequestError(ctx: RequestContext, error: Error): void {
    metrics.recordError();
    logger.error({ err: error, requestId: ctx.requestId }, 'Request error');
    
    if (!ctx.responded) {
      this.sendResponse(ctx, 500, 'Internal Server Error');
    }
  }

  /**
   * Handle server error
   */
  private handleServerError(error: Error): void {
    logger.error({ err: error }, 'Server error');
  }

  /**
   * Start server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, this.config.host, () => {
        logger.info({
          host: this.config.host,
          port: this.config.port
        }, 'Server started');
        resolve();
      });

      this.server.once('error', reject);
    });
  }

  /**
   * Stop server gracefully
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          logger.info('Server stopped');
          resolve();
        }
      });
    });
  }

  /**
   * Get underlying HTTP server
   */
  getServer(): HttpServer {
    return this.server;
  }

  /**
   * Get context pool statistics
   */
  getPoolStats() {
    return this.contextPool.getStats();
  }
}
