import http from 'http';
import { Socket } from 'net';
import { RequestContext, UpstreamTarget } from '../types/core.js';
import { BodyParser, ParsedBody } from './body-parser.js';
import { HttpClientPool } from './http-client-pool.js';
import { UrlForwarder } from './url-forward.js';
import { LoadBalancer, LoadBalancerContext } from './load-balancer.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { HealthChecker } from './health-checker.js';
import { RequestTransformer, RequestTransformation } from './request-transformer.js';
import { ResponseTransformer, ResponseTransformation } from './response-transformer.js';
import { CompressionHandler } from './compression-handler.js';
import { AdvancedMetrics } from './advanced-metrics.js';
import { logger } from '../utils/logger.js';

/**
 * Proxy handler configuration
 */
export interface ProxyHandlerConfig {
  /** Enable body parsing */
  enableBodyParsing?: boolean;
  /** Enable circuit breaker */
  enableCircuitBreaker?: boolean;
  /** Enable health checking */
  enableHealthChecking?: boolean;
  /** Request timeout in milliseconds */
  requestTimeout?: number;
  /** Enable request transformations */
  enableRequestTransformations?: boolean;
  /** Enable response transformations */
  enableResponseTransformations?: boolean;
  /** Enable compression */
  enableCompression?: boolean;
  /** Enable advanced metrics */
  enableAdvancedMetrics?: boolean;
  /** Maximum request size in bytes */
  maxRequestSize?: number;
  /** Maximum response size in bytes */
  maxResponseSize?: number;
  /** Maximum header size in bytes */
  maxHeaderSize?: number;
  /**
   * Enable WebSocket/SSE upgrade tunneling. When true, HTTP Upgrade
   * requests that match a route are tunneled to the route's upstream:
   * the gateway performs the upstream handshake, replies 101 to the
   * client, then pipes both sockets. Default false (upgrade is rejected).
   */
  enableWebSocket?: boolean;
}

/**
 * Default proxy handler configuration
 */
const DEFAULT_CONFIG: ProxyHandlerConfig = {
  enableBodyParsing: true,
  enableCircuitBreaker: true,
  enableHealthChecking: true,
  requestTimeout: 30000,
  enableRequestTransformations: false,
  enableResponseTransformations: false,
  enableCompression: false,
  enableAdvancedMetrics: false,
  maxRequestSize: 10485760, // 10MB
  maxResponseSize: 52428800, // 50MB
  maxHeaderSize: 16384, // 16KB
};

/**
 * Proxy handler for upstream requests
 */
export class ProxyHandler {
  private bodyParser: BodyParser;
  private clientPool: HttpClientPool;
  private urlForwarder: UrlForwarder;
  private loadBalancer: LoadBalancer;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private healthChecker: HealthChecker;
  private requestTransformer: RequestTransformer;
  private responseTransformer: ResponseTransformer;
  private compressionHandler: CompressionHandler;
  private advancedMetrics: AdvancedMetrics;
  private config: ProxyHandlerConfig;
  private upstreams: UpstreamTarget[] = [];
  private router?: { match(method: string, path: string): { route: { path: string; handler: unknown } } | null };

  /** Inject a router so upgrade tunneling can resolve routes. Optional —
   * without it, tunnelUpgrade always refuses (returns false). */
  public setRouter(router: { match(method: string, path: string): { route: { path: string; handler: unknown } } | null }): void {
    this.router = router;
  }

  constructor(config?: Partial<ProxyHandlerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize components
    this.bodyParser = new BodyParser();
    this.clientPool = new HttpClientPool();
    this.urlForwarder = new UrlForwarder(this.clientPool);
    this.loadBalancer = new LoadBalancer();
    this.healthChecker = new HealthChecker();
    this.requestTransformer = new RequestTransformer();
    this.responseTransformer = new ResponseTransformer();
    this.compressionHandler = new CompressionHandler();
    this.advancedMetrics = new AdvancedMetrics();
  }
  /**
   * Initialize with upstreams
   */
  initialize(upstreams: UpstreamTarget[]): void {
    this.upstreams = [...upstreams];
    this.clientPool.configure(this.upstreams.map(u => ({ id: u.id, poolSize: u.poolSize })));

    // Initialize load balancer
    this.loadBalancer.setUpstreams(this.upstreams);

    // Initialize circuit breakers
    for (const upstream of this.upstreams) {
      if (this.config.enableCircuitBreaker) {
        const breaker = new CircuitBreaker(upstream.id);
        this.circuitBreakers.set(upstream.id, breaker);
      }
    }

    // Start health checking
    if (this.config.enableHealthChecking) {
      this.healthChecker.start(this.upstreams);
    }

    logger.info(`Proxy handler initialized with ${this.upstreams.length} upstreams`);
  }

  /**
   * Set request transformations
   */
  setRequestTransformations(transformations: RequestTransformation[]): void {
    this.requestTransformer.setTransformations(transformations);
  }

  /**
   * Set response transformations
   */
  setResponseTransformations(transformations: ResponseTransformation[]): void {
    this.responseTransformer.setTransformations(transformations);
  }

  /**
   * Handle proxy request
   */
  async handle(ctx: RequestContext): Promise<void> {
    const startTime = process.hrtime.bigint();
    let requestSize = 0;
    let responseSize = 0;

    try {
      // Step 1: Check request size limits
      const contentLength = ctx.headers['content-length'];
      if (contentLength) {
        const size = parseInt(contentLength as string, 10);
        if (size > (this.config.maxRequestSize || 10485760)) {
          throw new Error('Request size exceeds limit');
        }
        requestSize = size;
      }

      // Step 2: Apply request transformations
      let transformedHeaders = ctx.headers;
      let transformedPath = ctx.path;
      let transformedBody: Buffer | undefined = undefined;

      if (this.config.enableRequestTransformations) {
        const transformResult = await this.requestTransformer.transform(
          ctx.method,
          ctx.path,
          ctx.headers,
          ctx.body || undefined
        );
        
        transformedHeaders = transformResult.headers;
        transformedPath = transformResult.path;
        transformedBody = transformResult.body;

        if (this.config.enableAdvancedMetrics) {
          this.advancedMetrics.recordRequestTransformation(transformResult.duration);
        }
      }

      // Step 3: Parse request body if needed
      let parsedBody: ParsedBody | null = null;
      if (this.shouldParseBody(ctx)) {
        ctx.timestamps.pluginStart = Date.now();
        parsedBody = await this.bodyParser.parse(ctx.req);
        ctx.timestamps.pluginEnd = Date.now();
        ctx.body = parsedBody?.buffer ?? ctx.body;
      }

      // Use transformed body if available, otherwise use parsed body
      const finalBody = transformedBody || parsedBody?.buffer || ctx.body;

      // Step 4: Select upstream via load balancer
      const lbContext: LoadBalancerContext = {
        clientIp: this.getClientIp(ctx),
        path: transformedPath,
      };

      const upstream = this.loadBalancer.select(lbContext);
      if (!upstream) {
        throw new Error('No healthy upstream available');
      }

      ctx.upstream = upstream;

      // Step 5: Check circuit breaker and proxy request
      const breaker = this.circuitBreakers.get(upstream.id);
      let responseData: { statusCode: number; headers: http.IncomingHttpHeaders; body?: Buffer } | null = null;

      if (breaker && this.config.enableCircuitBreaker) {
        await breaker.execute(async () => {
          responseData = await this.proxyRequest(ctx, upstream, transformedHeaders, transformedPath, finalBody);
        });
      } else {
        responseData = await this.proxyRequest(ctx, upstream, transformedHeaders, transformedPath, finalBody);
      }

      if (!responseData) {
        throw new Error('No response from upstream');
      }

      // Step 6: Apply response transformations
      let finalStatusCode = responseData.statusCode;
      let finalHeaders: http.OutgoingHttpHeaders = responseData.headers;
      let finalResponseBody = responseData.body;

      if (this.config.enableResponseTransformations) {
        const transformResult = await this.responseTransformer.transform(
          ctx.path,
          responseData.statusCode,
          responseData.headers,
          responseData.body
        );

        finalStatusCode = transformResult.statusCode;
        finalHeaders = transformResult.headers;
        finalResponseBody = transformResult.body;

        if (this.config.enableAdvancedMetrics) {
          this.advancedMetrics.recordResponseTransformation(transformResult.duration);
        }
      }

      // Step 7: Apply compression if needed
      if (this.config.enableCompression && finalResponseBody) {
        const acceptEncoding = ctx.headers['accept-encoding'] as string | undefined;
        const contentType = finalHeaders['content-type'] as string | undefined;
        const shouldCompress = this.compressionHandler.shouldCompress(
          contentType,
          finalResponseBody.length,
          acceptEncoding
        );

        if (shouldCompress) {
          const algorithm = this.compressionHandler.negotiateAlgorithm(acceptEncoding);
          if (algorithm) {
            const compressionResult = await this.compressionHandler.compress(finalResponseBody, algorithm);
            finalResponseBody = compressionResult.data;
            finalHeaders = this.compressionHandler.addCompressionHeaders(
              finalHeaders,
              algorithm,
              compressionResult.compressedSize
            );

            if (this.config.enableAdvancedMetrics) {
              this.advancedMetrics.recordCompression(
                compressionResult.originalSize,
                compressionResult.compressedSize,
                compressionResult.duration
              );
            }
          }
        }

        responseSize = finalResponseBody.length;
      }

      // Step 8: Send response
      ctx.res.writeHead(finalStatusCode, finalHeaders);
      if (finalResponseBody) {
        ctx.res.write(finalResponseBody);
      }
      ctx.res.end();
      ctx.responded = true;

      // Update metrics
      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      this.loadBalancer.recordLatency(upstream, duration);

      // Record passive health check
      if (this.config.enableHealthChecking) {
        this.healthChecker.recordPassiveCheck(upstream.id, true, duration);
      }

      // Record advanced metrics
      if (this.config.enableAdvancedMetrics) {
        this.advancedMetrics.recordRouteMetrics(
          ctx.path,
          requestSize,
          responseSize,
          duration,
          finalStatusCode,
          false
        );

        this.advancedMetrics.recordUpstreamMetrics(
          upstream.id,
          duration,
          requestSize,
          responseSize,
          false
        );
      }

      logger.debug(`Proxy request completed in ${duration.toFixed(3)}ms`);
    } catch (error) {
      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;

      // Record error
      if (ctx.upstream) {
        this.loadBalancer.recordError(ctx.upstream);

        // Record passive health check failure
        if (this.config.enableHealthChecking) {
          this.healthChecker.recordPassiveCheck(ctx.upstream.id, false, duration);
        }

        // Record error metrics
        if (this.config.enableAdvancedMetrics) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const category = this.advancedMetrics.categorizeError(undefined, errorMessage);
          this.advancedMetrics.recordError(category);

          this.advancedMetrics.recordUpstreamMetrics(
            ctx.upstream.id,
            duration,
            requestSize,
            responseSize,
            true
          );
        }
      }

      logger.error(`Proxy request failed: ${error}`);

      // Map error to a gateway-level response if nothing sent yet
      if (!ctx.responded && !ctx.res.headersSent) {
        const message = error instanceof Error ? error.message : String(error);
        let status = 502;
        let code = 'bad_gateway';
        if (message.toLowerCase().includes('timeout')) {
          status = 504;
          code = 'gateway_timeout';
        } else if (message.toLowerCase().includes('no healthy upstream')) {
          status = 503;
          code = 'service_unavailable';
        }
        ctx.res.writeHead(status, { 'Content-Type': 'application/json' });
        ctx.res.end(JSON.stringify({ error: { code, message: 'Upstream request failed' } }));
        ctx.responded = true;
      }

      throw error;
    }
  }

  /**
   * Proxy request to upstream
   */
  private async proxyRequest(
    ctx: RequestContext,
    upstream: UpstreamTarget,
    headers: http.IncomingHttpHeaders,
    path: string,
    body?: Buffer | null
  ): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body?: Buffer }> {
    ctx.timestamps.upstreamStart = Date.now();

    // ponytail: AbortController per proxied request; the client socket 'close'
    // event aborts the in-flight upstream fetch so we stop spending upstream
    // resources on a caller that is already gone. Ceiling: 'close' also fires
    // on normal completion — the listener is removed on finally, no leak.
    const ac = new AbortController();
    const onClose = (): void => {
      if (!ctx.responded) ac.abort();
    };
    ctx.req.on('close', onClose);

    try {
      // Coalesce identical in-flight GET/HEAD fetches (stampede guard)
      const useShare = ctx.method === 'GET' || ctx.method === 'HEAD';
      const dispatch = useShare ? this.urlForwarder.share.bind(this.urlForwarder) : this.urlForwarder.forward.bind(this.urlForwarder);
      const result = await dispatch({
        method: ctx.method,
        path,
        headers,
        body: body ?? ctx.body ?? null,
        upstream,
        timeout: ctx.route?.route.timeout ?? this.config.requestTimeout,
        signal: ac.signal,
      });
      ctx.timestamps.upstreamEnd = Date.now();
      return result;
    } finally {
      ctx.req.off('close', onClose);
    }
  }

  /**
   * Check if body should be parsed
   */
  private shouldParseBody(ctx: RequestContext): boolean {
    if (!this.config.enableBodyParsing) return false;
    if (ctx.body !== null) return false;

    // Parse body for POST, PUT, PATCH methods with content
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(ctx.method);
    const contentLength = ctx.headers['content-length'];
    const hasContentLength = contentLength !== undefined && contentLength !== '0' && parseInt(contentLength as string, 10) > 0;

    return hasBody && hasContentLength;
  }

  /**
   * Get client IP address
   */
  private getClientIp(ctx: RequestContext): string {
    // Check X-Forwarded-For header
    const forwarded = ctx.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      if (ips) {
        const firstIp = ips.split(',')[0]?.trim();
        return firstIp || '';
      }
    }

    // Check X-Real-IP header
    const realIp = ctx.headers['x-real-ip'];
    if (realIp) {
      const ip = Array.isArray(realIp) ? realIp[0] : realIp;
      return ip || '';
    }

    // Fallback to socket address
    return ctx.req.socket.remoteAddress || '';
  }

  /**
   * Tunnel an HTTP Upgrade request (WebSocket) to the matched route's
   * upstream. Performs the upstream handshake, writes 101 to the client,
   * then pipes the two sockets. Returns false when the route/upstream
   * cannot be resolved so the server can reject the upgrade.
   *
   * ponytail: raw bidirectional pipe, no per-frame inspection, no LB
   * re-selection on upstream failure. Ceiling: a dead upstream kills the
   * tunnel (no failover mid-stream). Upgrade path: frame-aware proxy with
   * reconnect.
   */
  public async tunnelUpgrade(
    req: http.IncomingMessage,
    clientSocket: Socket,
    head: Buffer
  ): Promise<boolean> {
    if (!this.config.enableWebSocket) return false;

    const method = (req.method || 'GET') as RequestContext['method'];
    const path = (req.url || '/').split('?')[0] ?? '/';
    const routeMatch = this.router?.match?.(method, path);
    if (!routeMatch) return false;

    const upstream = this.resolveUpstreamForRoute(routeMatch.route);
    if (!upstream) return false;

    const headers: http.OutgoingHttpHeaders = { ...req.headers, host: `${upstream.host}:${upstream.port}` };

    const client = upstream.protocol === 'https' ? await import('node:https') : http;
    const upstreamReq = client.request({
      hostname: upstream.host,
      port: upstream.port,
      path: (upstream.basePath || '') + (req.url || '/'),
      method,
      headers,
    });

    return await new Promise<boolean>((resolve) => {
      upstreamReq.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
        const responseLines: string[] = [`HTTP/1.1 101 Switching Protocols`];
        for (const [k, v] of Object.entries(upstreamRes.headers)) {
          if (v === undefined) continue;
          responseLines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
        }
        clientSocket.write(responseLines.join('\r\n') + '\r\n\r\n');

        if (head.length > 0) upstreamSocket.write(head);
        if (upstreamHead.length > 0) clientSocket.write(upstreamHead);

        upstreamSocket.pipe(clientSocket);
        clientSocket.pipe(upstreamSocket);

        const closeBoth = (): void => {
          if (!clientSocket.destroyed) clientSocket.destroy();
          if (!upstreamSocket.destroyed) upstreamSocket.destroy();
        };
        clientSocket.on('error', closeBoth);
        upstreamSocket.on('error', closeBoth);
        clientSocket.on('close', closeBoth);
        upstreamSocket.on('close', closeBoth);

        logger.info({ path, upstream: upstream.id }, 'WebSocket tunnel established');
        resolve(true);
      });

      upstreamReq.on('response', (res) => {
        // Upstream refused the upgrade: forward the status then close.
        clientSocket.write(`HTTP/1.1 ${res.statusCode ?? 502} Upgrade Refused\r\nConnection: close\r\n\r\n`);
        clientSocket.destroy();
        resolve(true);
      });

      upstreamReq.on('error', (err) => {
        logger.error({ err, path, upstream: upstream.id }, 'WebSocket upstream handshake failed');
        clientSocket.destroy();
        resolve(true); // handled (rejected) — not a "no route" case
      });

      upstreamReq.end();
    });
  }

  /**
   * Resolve the upstream for a route. Uses the load balancer when the
   * route has no explicit upstream binding, matching the HTTP path's
   * behaviour as closely as the tunnel case allows.
   */
  private resolveUpstreamForRoute(route: { handler: unknown; path: string }): UpstreamTarget | null {
    // ponytail: the HTTP path resolves upstreams via the pipeline context;
    // for tunnels there is no RequestContext yet, so we pick the first
    // healthy upstream through the load balancer directly.
    const lb = this.loadBalancer;
    if (!lb) return null;
    const lbCtx: LoadBalancerContext = { path: route.path } as LoadBalancerContext;
    const upstream = lb.select(lbCtx);
    return upstream ?? null;
  }

  /**
   * Get load balancer
   */
  getLoadBalancer(): LoadBalancer {
    return this.loadBalancer;
  }

  /**
   * Get health checker
   */
  getHealthChecker(): HealthChecker {
    return this.healthChecker;
  }

  /**
   * Get circuit breaker for upstream
   */
  getCircuitBreaker(upstreamId: string): CircuitBreaker | undefined {
    return this.circuitBreakers.get(upstreamId);
  }

  /**
   * Get client pool
   */
  getClientPool(): HttpClientPool {
    return this.clientPool;
  }

  /**
   * Get request transformer
   */
  getRequestTransformer(): RequestTransformer {
    return this.requestTransformer;
  }

  /**
   * Get response transformer
   */
  getResponseTransformer(): ResponseTransformer {
    return this.responseTransformer;
  }

  /**
   * Get compression handler
   */
  getCompressionHandler(): CompressionHandler {
    return this.compressionHandler;
  }

  /**
   * Get advanced metrics
   */
  getAdvancedMetrics(): AdvancedMetrics {
    return this.advancedMetrics;
  }

  /**
   * Shutdown handler
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down proxy handler');

    // Stop health checker
    this.healthChecker.stop();

    // Destroy client pool
    this.clientPool.destroy();

    logger.info('Proxy handler shutdown complete');
  }
}
