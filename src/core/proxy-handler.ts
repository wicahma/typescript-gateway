/**
 * Proxy handler for upstream requests with Phase 4 integration
 * Phase 4: Upstream Integration & Resilience
 * 
 * Integrates: Body Parser, HTTP Client Pool, Load Balancer,
 *             Circuit Breaker, Health Checker
 */

import http from 'http';
import https from 'https';
import { RequestContext, UpstreamTarget } from '../types/core.js';
import { BodyParser, ParsedBody } from './body-parser.js';
import { HttpClientPool } from './http-client-pool.js';
import { LoadBalancer, LoadBalancerContext } from './load-balancer.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { HealthChecker } from './health-checker.js';
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
}

/**
 * Default proxy handler configuration
 */
const DEFAULT_CONFIG: ProxyHandlerConfig = {
  enableBodyParsing: true,
  enableCircuitBreaker: true,
  enableHealthChecking: true,
  requestTimeout: 30000,
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
  private config: ProxyHandlerConfig;
  private upstreams: UpstreamTarget[] = [];

  constructor(config?: Partial<ProxyHandlerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize components
    this.bodyParser = new BodyParser();
    this.clientPool = new HttpClientPool();
    this.loadBalancer = new LoadBalancer();
    this.healthChecker = new HealthChecker();
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
   * Handle proxy request
   */
  async handle(ctx: RequestContext): Promise<void> {
    const startTime = process.hrtime.bigint();

    try {
      // Step 1: Parse request body if needed
      let parsedBody: ParsedBody | null = null;
      if (this.shouldParseBody(ctx)) {
        ctx.timestamps.pluginStart = Date.now();
        parsedBody = await this.bodyParser.parse(ctx.req);
        ctx.timestamps.pluginEnd = Date.now();
      }

      // Step 2: Select upstream via load balancer
      const lbContext: LoadBalancerContext = {
        clientIp: this.getClientIp(ctx),
        path: ctx.path,
      };

      const upstream = this.loadBalancer.select(lbContext);
      if (!upstream) {
        throw new Error('No healthy upstream available');
      }

      ctx.upstream = upstream;

      // Step 3: Check circuit breaker
      const breaker = this.circuitBreakers.get(upstream.id);
      if (breaker && this.config.enableCircuitBreaker) {
        await breaker.execute(async () => {
          await this.proxyRequest(ctx, upstream, parsedBody);
        });
      } else {
        await this.proxyRequest(ctx, upstream, parsedBody);
      }

      // Update metrics
      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      this.loadBalancer.recordLatency(upstream, duration);

      // Record passive health check
      if (this.config.enableHealthChecking) {
        this.healthChecker.recordPassiveCheck(upstream.id, true, duration);
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
    parsedBody: ParsedBody | null
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ctx.timestamps.upstreamStart = Date.now();

      // Get connection from pool
      this.clientPool
        .acquire(upstream)
        .then((agent) => {
          const isHttps = upstream.protocol === 'https';
          const client = isHttps ? https : http;

          // Build request path
          const requestPath = upstream.basePath + ctx.path;

          // Build request options
          const options: http.RequestOptions = {
            hostname: upstream.host,
            port: upstream.port,
            path: requestPath,
            method: ctx.method,
            headers: { ...ctx.headers },
            agent,
            timeout: this.config.requestTimeout,
          };

          // Update content-length if body was parsed
          if (parsedBody?.buffer) {
            if (options.headers && typeof options.headers === 'object' && !Array.isArray(options.headers)) {
              const headers = options.headers as http.OutgoingHttpHeaders;
              headers['content-length'] = parsedBody.buffer.length;
            }
          }

          // Create request
          const proxyReq = client.request(options, (proxyRes) => {
            ctx.timestamps.upstreamEnd = Date.now();

            // Stream response back to client
            ctx.res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);

            proxyRes.pipe(ctx.res);

            proxyRes.on('end', () => {
              // Release connection back to pool
              this.clientPool.release(upstream, agent);
              resolve();
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
          if (parsedBody?.buffer) {
            proxyReq.write(parsedBody.buffer);
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
