/**
 * Proxy handler for upstream requests with Phase 6 enhancements
 * Phase 6: Proxy Logic & Request Forwarding
 * 
 * Integrates: Body Parser, HTTP Client Pool, Load Balancer,
 *             Circuit Breaker, Health Checker, Request/Response Transformers,
 *             Compression Handler, Advanced Metrics
 */

import http from 'http';
import https from 'https';
import { RequestContext, UpstreamTarget } from '../types/core.js';
import { BodyParser, ParsedBody } from './body-parser.js';
import { HttpClientPool } from './http-client-pool.js';
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
}

/**
 * Default proxy handler configuration
 */
const DEFAULT_CONFIG: ProxyHandlerConfig = {
  enableBodyParsing: true,
  enableCircuitBreaker: true,
  enableHealthChecking: true,
  requestTimeout: 30000,
  enableRequestTransformations: true,
  enableResponseTransformations: true,
  enableCompression: true,
  enableAdvancedMetrics: true,
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
  private loadBalancer: LoadBalancer;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private healthChecker: HealthChecker;
  private requestTransformer: RequestTransformer;
  private responseTransformer: ResponseTransformer;
  private compressionHandler: CompressionHandler;
  private advancedMetrics: AdvancedMetrics;
  private config: ProxyHandlerConfig;
  private upstreams: UpstreamTarget[] = [];

  constructor(config?: Partial<ProxyHandlerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize components
    this.bodyParser = new BodyParser();
    this.clientPool = new HttpClientPool();
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
    return new Promise((resolve, reject) => {
      ctx.timestamps.upstreamStart = Date.now();

      // Get connection from pool
      this.clientPool
        .acquire(upstream)
        .then((agent) => {
          const isHttps = upstream.protocol === 'https';
          const client = isHttps ? https : http;

          // Build request path
          const requestPath = upstream.basePath + path;

          // Build request options
          const options: http.RequestOptions = {
            hostname: upstream.host,
            port: upstream.port,
            path: requestPath,
            method: ctx.method,
            headers: { ...headers },
            agent,
            timeout: this.config.requestTimeout,
          };

          // Update content-length if body exists
          if (body) {
            if (options.headers && typeof options.headers === 'object' && !Array.isArray(options.headers)) {
              const hdrs = options.headers as http.OutgoingHttpHeaders;
              hdrs['content-length'] = body.length;
            }
          }

          // Create request
          const proxyReq = client.request(options, (proxyRes) => {
            ctx.timestamps.upstreamEnd = Date.now();

            const chunks: Buffer[] = [];
            
            proxyRes.on('data', (chunk: Buffer) => {
              chunks.push(chunk);
            });

            proxyRes.on('end', () => {
              // Release connection back to pool
              this.clientPool.release(upstream, agent);
              
              const responseBody = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
              
              resolve({
                statusCode: proxyRes.statusCode || 500,
                headers: proxyRes.headers,
                body: responseBody,
              });
            });

            proxyRes.on('error', (error) => {
              this.clientPool.remove(upstream, agent);
              reject(error);
            });
          });

          // Handle request errors
          proxyReq.on('error', (error) => {
            this.clientPool.remove(upstream, agent);
            reject(error);
          });

          proxyReq.on('timeout', () => {
            proxyReq.destroy();
            this.clientPool.remove(upstream, agent);
            reject(new Error('Upstream request timeout'));
          });

          // Send body if present
          if (body) {
            proxyReq.write(body);
          } else if (ctx.body) {
            proxyReq.write(ctx.body);
          }

          proxyReq.end();
        })
        .catch(reject);
    });
  }

  /**
   * Check if body should be parsed
   */
  private shouldParseBody(ctx: RequestContext): boolean {
    if (!this.config.enableBodyParsing) return false;

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
