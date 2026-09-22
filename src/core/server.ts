import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from 'http';
import { Socket } from 'net';
import { ServerConfig, HttpMethod, RequestContext } from '../types/core.js';
import { Router } from './router.js';
import { ContextPool } from './context.js';
import { RequestPipeline } from '../pipeline/request-pipeline.js';
import { metrics } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';

/**
 * Native HTTP server implementation
 *
 */
export class Server {
  private server: HttpServer;
  private router: Router;
  private config: ServerConfig;
  private contextPool: ContextPool;
  private requestIdCounter = 0;
  private accessLogSampleRate: number;
  private activeSockets = new Set<Socket>();
  private isShuttingDown = false;
  private pipeline?: RequestPipeline;
  private proxyHandler?: { tunnelUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): Promise<boolean> };

  constructor(config: ServerConfig, router: Router) {
    this.config = config;
    this.router = router;
    this.accessLogSampleRate = Math.max(1, (config as unknown as Record<string, unknown>)['accessLogSampleRate'] as number ?? 1);

    // Initialize request context pool with configurable size
    this.contextPool = new ContextPool(1000);

    // Create native HTTP server with
    this.server = createServer({
      keepAlive: config.keepAlive,
      keepAliveTimeout: config.keepAliveTimeout,
      maxHeaderSize: config.maxHeaderSize,
    });

    //
    this.server.keepAliveTimeout = 65000; // 65 seconds
    this.server.headersTimeout = 66000; // Slightly higher than keepAliveTimeout
    this.server.maxHeadersCount = 100; // Prevent DoS
    this.server.requestTimeout = config.requestTimeout || 120000; // 120 seconds

    // Setup request handler
    this.server.on('request', this.handleRequest.bind(this));

    // Setup connection handler for tracking
    this.server.on('connection', this.handleConnection.bind(this));

    // Setup upgrade handler (WebSocket support
    this.server.on('upgrade', this.handleUpgrade.bind(this));

    // Setup error handler
    this.server.on('error', this.handleServerError.bind(this));
  }

  /**
   * Handle new connection
   */
  private handleConnection(socket: Socket): void {
    // Reject new connections during shutdown
    if (this.isShuttingDown) {
      socket.destroy();
      return;
    }

    // Track socket for graceful shutdown
    this.activeSockets.add(socket);
    metrics.incrementConnections();

    // Remove from tracking when closed
    socket.on('close', () => {
      this.activeSockets.delete(socket);
      metrics.decrementConnections();
    });

    // Set socket timeout
    socket.setTimeout(this.config.requestTimeout);

    // Handle socket timeout
    socket.on('timeout', () => {
      socket.destroy();
    });
  }

  /**
   * Handle WebSocket upgrade requests — tunnel via ProxyHandler when
   * WebSocket support is enabled, otherwise reject.
   */
  private handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    if (!this.proxyHandler) {
      logger.debug('WebSocket upgrade requested (WebSocket disabled)');
      socket.destroy();
      return;
    }
    void this.proxyHandler.tunnelUpgrade(req, socket, head).then((tunneled) => {
      if (!tunneled && !socket.destroyed) {
        logger.debug({ path: req.url }, 'WebSocket upgrade rejected (no matching route/upstream)');
        socket.destroy();
      }
    });
  }

  /** Attach a proxy handler capable of tunnelUpgrade. Optional. */
  setProxyHandler(handler: { tunnelUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): Promise<boolean> }): void {
    this.proxyHandler = handler;
  }

  /**
   * Handle incoming HTTP request
   * Zero-copy, minimal allocations
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Fast-fail during shutdown
    if (this.isShuttingDown) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('Service Unavailable - Server is shutting down');
      return;
    }

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

      // Check request size limit
      const contentLength = req.headers['content-length'];
      if (contentLength) {
        const size = parseInt(contentLength as string, 10);
        const maxSize = this.config.maxBodySize || 10485760;
        if (size > maxSize) {
          this.sendResponse(ctx, 413, 'Payload Too Large');
          return;
        }
      }

      // Match route
      const match = this.router.match(ctx.method, ctx.path);

      if (!match) {
        this.send404(ctx);
        return;
      }

      // Set route params and match info
      ctx.params = match.params;
      ctx.route = match;

      // Run inbound policy pipeline (short-circuits with a Response if a policy returns one)
      if (this.pipeline) {
        const problem = await this.pipeline.runInbound(ctx);
        if (problem) {
          await RequestPipeline.writeResponse(ctx.res, problem);
          ctx.responded = true;
          return;
        }
      }

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

      // Access logging
      const shouldLog =
        ctx.res.statusCode >= 500 ||
        this.requestIdCounter % this.accessLogSampleRate === 0;
      if (shouldLog) {
        logger.info(
          {
            requestId: ctx.requestId,
            method: ctx.method,
            path: ctx.path,
            status: ctx.res.statusCode,
            durationMs: Number(process.hrtime.bigint() - startTime) / 1_000_000,
          },
          'Request completed'
        );
      }

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
    if (ctx.responded || ctx.res.headersSent) return;

    ctx.res.writeHead(statusCode, {
      'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/octet-stream',
      'Content-Length': Buffer.byteLength(body),
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

    if (!ctx.responded && !ctx.res.headersSent) {
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
        logger.info(
          {
            host: this.config.host,
            port: this.config.port,
          },
          'Server started'
        );
        resolve();
      });

      this.server.once('error', reject);
    });
  }

  /**
   * Stop server gracefully
   */
  async stop(): Promise<void> {
    logger.info('Initiating graceful shutdown');
    this.isShuttingDown = true;

    // Stop accepting new connections
    return new Promise((resolve, reject) => {
      this.server.close((err: Error | undefined) => {
        if (err) {
          reject(err);
          return;
        }

        logger.info('Server stopped accepting new connections');
      });

      // Drain existing connections
      const drainTimeout = setTimeout(() => {
        logger.warn(
          { activeConnections: this.activeSockets.size },
          'Force closing remaining connections after timeout'
        );
        // Force close remaining sockets
        for (const socket of this.activeSockets) {
          socket.destroy();
        }
      }, 30000); // 30 second drain timeout

      // Wait for all connections to close
      const checkInterval = setInterval(() => {
        if (this.activeSockets.size === 0) {
          clearInterval(checkInterval);
          clearTimeout(drainTimeout);
          logger.info('All connections drained, server stopped');
          resolve();
        }
      }, 100);
    });
  }

  /**
   * Get underlying HTTP server
   */
  setPipeline(pipeline: RequestPipeline): void {
    this.pipeline = pipeline;
  }

  getServer(): HttpServer {
    return this.server;
  }

  /**
   * Get context pool statistics
   */
  getPoolStats() {
    return this.contextPool.metrics();
  }

  /**
   * Get pool hit rate percentage
   */
  getPoolHitRate(): number {
    return this.contextPool.getHitRate();
  }

  /**
   * Get active connection count
   */
  getActiveConnectionCount(): number {
    return this.activeSockets.size;
  }
}
