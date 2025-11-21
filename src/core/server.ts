/**
 * Native HTTP server wrapper
 * Zero-copy request/response handling with proper backpressure
 * Phase 2: Enhanced connection management and graceful shutdown
 */

import { createServer, IncomingMessage, ServerResponse, Server as HttpServer } from 'http';
import { Socket } from 'net';
import { ServerConfig, HttpMethod } from '../types/core.js';
import { Router } from './router.js';
import { ContextPool } from './context.js';
import { metrics } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';

/**
 * Native HTTP server implementation
 * Phase 2: Enhanced with proper connection lifecycle and graceful shutdown
 */
export class Server {
  private server: HttpServer;
  private router: Router;
  private config: ServerConfig;
  private contextPool: ContextPool;
  private requestIdCounter = 0;
  private activeSockets = new Set<Socket>();
  private isShuttingDown = false;

  constructor(config: ServerConfig, router: Router) {
    this.config = config;
    this.router = router;

    // Initialize request context pool with configurable size
    this.contextPool = new ContextPool(1000);

    // Create native HTTP server with Phase 2 performance tuning
    this.server = createServer({
      keepAlive: config.keepAlive,
      keepAliveTimeout: config.keepAliveTimeout,
      maxHeaderSize: config.maxHeaderSize,
    });

    // Phase 2: Enhanced performance settings
    this.server.keepAliveTimeout = 65000; // 65 seconds
    this.server.headersTimeout = 66000; // Slightly higher than keepAliveTimeout
    this.server.maxHeadersCount = 100; // Prevent DoS
    this.server.requestTimeout = config.requestTimeout || 120000; // 120 seconds

    // Setup request handler
    this.server.on('request', this.handleRequest.bind(this));

    // Setup connection handler for tracking
    this.server.on('connection', this.handleConnection.bind(this));

    // Setup upgrade handler (WebSocket support - Phase 2 future-ready)
    this.server.on('upgrade', this.handleUpgrade.bind(this));

    // Setup error handler
    this.server.on('error', this.handleServerError.bind(this));
  }

  /**
   * Handle new connection - Phase 2 enhanced tracking
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
   * Handle WebSocket upgrade requests - Phase 2 future-ready
   */
  private handleUpgrade(
    _req: IncomingMessage,
    socket: Socket,
    _head: Buffer
  ): void {
    // Placeholder for Phase 2+ WebSocket support
    // Currently just destroy the socket
    logger.debug('WebSocket upgrade requested (not yet supported)');
    socket.destroy();
  }

  /**
   * Handle incoming HTTP request
   * Zero-copy, minimal allocations - Phase 2 optimized
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

      // Match route
      const match = this.router.match(ctx.method, ctx.path);

      if (!match) {
        this.send404(ctx);
        return;
      }

      // Set route params and match info
      ctx.params = match.params;
      ctx.route = match;

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
  private sendResponse(
    ctx: import('../types/core.js').RequestContext,
    statusCode: number,
    body: string | Buffer
  ): void {
    if (ctx.responded) return;

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
  private send404(ctx: import('../types/core.js').RequestContext): void {
    this.sendResponse(ctx, 404, 'Not Found');
  }

  /**
   * Handle request error
   */
  private handleRequestError(ctx: import('../types/core.js').RequestContext, error: Error): void {
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
   * Stop server gracefully - Phase 2 enhanced with connection draining
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
  getServer(): HttpServer {
    return this.server;
  }

  /**
   * Get context pool statistics - Phase 2 enhanced
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
