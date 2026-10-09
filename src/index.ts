import { realpathSync } from 'fs';
import { pathToFileURL } from 'url';
import { Server } from './core/server.js';
import { Router } from './core/router.js';
import { ProxyHandler } from './core/proxy-handler.js';
import { ResponseCache } from './core/response-cache.js';
import { ResponseCachePolicy } from './core/response-cache-policy.js';
import { createConfigLoader } from './config/loader.js';
import { RequestPipeline } from './pipeline/request-pipeline.js';
import { PluginPolicy } from './pipeline/policy.js';
import { Plugin } from './types/plugin.js';
import { logger } from './utils/logger.js';
import { metrics } from './utils/metrics.js';
import { ConfigFile } from './types/config.js';
import { AuthJwtPolicy } from './plugins/builtin/auth-jwt-policy.js';
import { ConsumerStore } from './identity/consumer-store.js';
import { ApiKeyPolicy } from './identity/api-key-policy.js';
import { ConsumerRateLimitPolicy } from './identity/consumer-rate-limit-policy.js';
import { UpstreamCredentialStore } from './identity/upstream-credential-store.js';
import { SetUpStreamHeaderPolicy } from './identity/set-upstream-header-policy.js';
import { HmacSignPolicy } from './identity/hmac-sign-policy.js';
import { CorsPolicy } from './pipeline/cors-policy.js';
import { TraceContextPolicy } from './pipeline/trace-context-policy.js';
import { IdempotencyPolicy } from './pipeline/idempotency-policy.js';
import { SecretMaskPolicy } from './pipeline/secret-mask-policy.js';
import { LoadShedPolicy } from './pipeline/load-shed-policy.js';
import { ConcurrencyLimiter } from './core/concurrency-limiter.js';
import { ShadowPolicy } from './pipeline/shadow-policy.js';
import { SsrfGuardPolicy } from './pipeline/ssrf-guard-policy.js';
import { SecurityHeadersPolicy } from './pipeline/security-headers-policy.js';
import { VerifyInboundHmacPolicy } from './identity/verify-inbound-hmac-policy.js';
import { StickySessionPolicy } from './pipeline/sticky-session-policy.js';
import { AdminControlPlane } from './admin/control-plane.js';
import { RecordStore } from './pipeline/record-store.js';
import { RecordPolicy } from './pipeline/record-policy.js';
import { ReplayPolicy } from './pipeline/replay-policy.js';
import { AuditPolicy } from './pipeline/audit-policy.js';
import { routesFromOpenApi } from './config/openapi-routes.js';
import { WithIdentity } from './types/identity.js';
import { UpstreamTarget, CircuitBreakerState, RequestContext } from './types/core.js';
import { AuthJwtPlugin } from './plugins/builtin/auth-jwt.js';
import { HeaderTransformerPlugin } from './plugins/builtin/header-transformer.js';
import { RateLimitPlugin } from './plugins/builtin/rate-limit-plugin.js';
import { RequestIdPlugin } from './plugins/builtin/request-id.js';
import { RequestLoggerPlugin } from './plugins/builtin/request-logger.js';
import { ResponseTimePlugin } from './plugins/builtin/response-time.js';

export class Gateway {
  private server: Server | null = null;
  private router: Router;
  private proxyHandler: ProxyHandler | null = null;
  private currentConfig: ConfigFile | null = null;
  private configLoader;
  private metricsInterval: NodeJS.Timeout | null = null;
  private pipeline = new RequestPipeline();
  private cache: ResponseCache | null = null;
  private loadShedInfo: Record<string, unknown> = {};
  private boundPort = 0;
  private boundHost = '';

  constructor(configPath: string) {
    this.router = new Router();
    this.configLoader = createConfigLoader({
      configPath,
      hotReload: false, // enabled after first load when the file says so
      reloadInterval: 5000,
      validate: true,
      interpolate: true,
    });
  }

  async start(): Promise<void> {
    const config = await this.configLoader.load();
    this.currentConfig = config;
    this.registerSystemRoutes();

    this.boundPort = Number(process.env['PORT']) || config.server.port;
    this.boundHost = process.env['HOST'] || config.server.host;
    const serverConfig = {
      ...config.server,
      port: this.boundPort,
      host: this.boundHost,
    };

    this.server = new Server(serverConfig, this.router);
    this.server.setPipeline(this.pipeline);

    // Server must exist before proxy routing is wired: setupProxyRouting
    // only registers WS upgrade handling when this.server is set.
    this.setupProxyRouting(config);
    this.configurePipeline(config);

    await this.server.start();

    this.setupMetricsReporting();
    this.setupShutdownHandlers();

    // Hot reload: rebuild routes/pipeline/upstreams on config change without
    // touching the listening socket (v1 ceiling: server.port/host changes
    // need stop()+start()).
    this.configLoader.setReloadHandler(cfg => this.applyConfig(cfg));
    const reloadKeys = config as unknown as Record<string, unknown>;
    if (reloadKeys['hotReload'] === true) {
      const interval = reloadKeys['reloadInterval'];
      this.configLoader.startWatching(typeof interval === 'number' ? interval : 5000);
    }

    logger.info({ port: serverConfig.port, host: serverConfig.host }, 'Gateway started');
  }
  async stop(): Promise<void> {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }

    if (this.proxyHandler) {
      await this.proxyHandler.shutdown();
      this.proxyHandler = null;
    }

    if (this.server) {
      await this.server.stop();
      this.server = null;
    }

    this.configLoader.destroy();
    logger.info('Gateway stopped');
  }

  getRouter(): Router {
    return this.router;
  }

  registerPlugin(plugin: Plugin, config: Record<string, unknown> = {}): void {
    this.pipeline.register(new PluginPolicy(plugin, config));
    plugin.init?.(config);
  }

  getServer(): Server | null {
    return this.server;
  }

  private registerSystemRoutes(): void {
    const adminConfig = (
      this.currentConfig as unknown as {
        admin?: {
          enabled?: boolean;
          basePath?: string;
          requireAuth?: boolean;
          requiredPlan?: string;
        };
      } | null
    )?.admin;
    if (adminConfig?.enabled) {
      const plane = new AdminControlPlane(
        {
          getUptime: () => process.uptime(),
          getBreakers: () => {
            const out: Record<string, string> = {};
            const upstreams = this.currentConfig?.upstreams ?? [];
            for (const u of upstreams) {
              const breaker = this.proxyHandler?.getCircuitBreaker(u.id);
              out[u.id] = breaker ? String(breaker.getState()) : 'UNKNOWN';
            }
            return out;
          },
          getCacheStats: () => this.cache?.getStats() ?? {},
          getLoadShed: () => this.loadShedInfo ?? {},
          purgeCache: (pattern: RegExp) => this.cache?.purge(pattern) ?? 0,
          getPolicies: () => this.pipeline.getPolicyNames(),
        },
        {
          basePath: adminConfig.basePath,
          requireAuth: adminConfig.requireAuth,
          requiredPlan: adminConfig.requiredPlan,
        }
      );
      plane.register(this.router);
    }

    this.router.register('GET', '/health', async ctx => {
      let report: Record<string, unknown> = { status: 'ok', uptime: process.uptime() };
      try {
        if (this.proxyHandler) {
          report = {
            ...this.proxyHandler.getHealthChecker().getHealthReport(),
            uptime: process.uptime(),
          };
        }
      } catch {
        // fall back to basic health
      }
      ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify(report));
      ctx.responded = true;
    });

    const mon = this.currentConfig?.monitoring;
    const promPath = mon?.export?.prometheus?.path;
    const serveMetrics = async (ctx: RequestContext): Promise<void> => {
      const snapshot = metrics.snapshot() as unknown as Record<string, unknown>;
      if (mon?.metrics?.enabled && this.proxyHandler) {
        // B6: monitoring.metrics.enabled surfaces the ProxyHandler's
        // AdvancedMetrics (route/upstream views) on the metrics endpoint.
        const am = this.proxyHandler.getAdvancedMetrics();
        snapshot['advanced'] = {
          routes: am.getRouteMetrics(),
          upstreams: am.getUpstreamMetrics(),
        };
      }
      ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify(snapshot, null, 2));
      ctx.responded = true;
    };

    // monitoring.export.prometheus.path, when set, is the metrics endpoint
    // (default '/metrics' stays registered for compatibility).
    this.router.register('GET', promPath ?? '/metrics', serveMetrics);
    if (promPath && promPath !== '/metrics') {
      this.router.register('GET', '/metrics', serveMetrics);
    }

    this.router.register('GET', '/', async ctx => {
      ctx.res.writeHead(200, { 'Content-Type': 'text/plain' });
      ctx.res.end('TypeScript Service Gateway');
      ctx.responded = true;
    });
  }

  private configurePipeline(config: ConfigFile): void {
    const cfg = config as unknown as WithIdentity;
    if (cfg.loadShedding?.enabled) {
      const limiter = new ConcurrencyLimiter({
        min: cfg.loadShedding.min ?? 16,
        max: cfg.loadShedding.max ?? 1024,
        targetP95Ms: cfg.loadShedding.targetP95Ms ?? 250,
      });
      this.loadShedInfo = { limit: limiter.currentLimit(), inflight: limiter.inFlight() };
      this.pipeline.register(new LoadShedPolicy(limiter));
    }
    if (cfg.cors?.enabled) {
      this.pipeline.register(
        new CorsPolicy({
          allowOrigins: cfg.cors.allowOrigins,
          allowMethods: cfg.cors.allowMethods,
          allowHeaders: cfg.cors.allowHeaders,
          allowCredentials: cfg.cors.allowCredentials,
          maxAgeSeconds: cfg.cors.maxAgeSeconds,
        })
      );
    }
    if (cfg.traceContext?.enabled) {
      this.pipeline.register(new TraceContextPolicy());
    }
    if (cfg.idempotency?.enabled) {
      this.pipeline.register(
        new IdempotencyPolicy({
          ttlMs: cfg.idempotency.ttlMs,
          maxEntries: cfg.idempotency.maxEntries,
        })
      );
    }
    if (cfg.secretMask?.enabled) {
      this.pipeline.register(new SecretMaskPolicy({ replacement: cfg.secretMask.replacement }));
    }
    if (cfg.ssrfGuard?.enabled) {
      this.pipeline.register(
        new SsrfGuardPolicy({
          allowlist: cfg.ssrfGuard.allowlist,
          allowPrivate: cfg.ssrfGuard.allowPrivate,
          blockLinkLocal: cfg.ssrfGuard.blockLinkLocal,
        })
      );
    }
    if (cfg.verifyInboundHmac?.enabled) {
      this.pipeline.register(
        new VerifyInboundHmacPolicy({
          secret: cfg.verifyInboundHmac.secret,
          headerName: cfg.verifyInboundHmac.headerName,
          timestampHeader: cfg.verifyInboundHmac.timestampHeader,
          publicRoutes: cfg.verifyInboundHmac.publicRoutes,
          maxAgeSeconds: cfg.verifyInboundHmac.maxAgeSeconds,
        })
      );
    }
    if (cfg.stickySession?.enabled && cfg.stickySession.upstreams?.length) {
      this.pipeline.register(
        new StickySessionPolicy({
          upstreams: cfg.stickySession.upstreams,
          headerName: cfg.stickySession.headerName,
          cookieName: cfg.stickySession.cookieName,
          ttlMs: cfg.stickySession.ttlMs,
        })
      );
    }
    if (cfg.shadow?.enabled) {
      this.pipeline.register(
        new ShadowPolicy({
          target: cfg.shadow.target,
          sampleRate: cfg.shadow.sampleRate,
          methods: cfg.shadow.methods,
          maxInflight: cfg.shadow.maxInflight,
        })
      );
    }
    if (cfg.securityHeaders?.enabled) {
      this.pipeline.register(
        new SecurityHeadersPolicy({
          hsts: cfg.securityHeaders.hsts,
          stripServer: cfg.securityHeaders.stripServer,
          frameOptions: cfg.securityHeaders.frameOptions,
          referrerPolicy: cfg.securityHeaders.referrerPolicy,
          contentTypeOptions: cfg.securityHeaders.contentTypeOptions,
        })
      );
    }
    const authConfig = config.auth;
    if (authConfig && authConfig.enabled !== false) {
      this.pipeline.register(new AuthJwtPolicy(authConfig));
    }
    const apiKeyConfig = cfg.apiKeys;
    if (apiKeyConfig?.enabled && apiKeyConfig.consumers?.length) {
      const store = new ConsumerStore();
      for (const consumer of apiKeyConfig.consumers) {
        store.createConsumer(
          consumer.consumerId,
          consumer.plan,
          consumer.rateLimit,
          consumer.dailyLimit
        );
        for (const key of consumer.keys ?? []) {
          store.issueKey(consumer.consumerId, key.key, { expiresAt: key.expiresAt });
        }
      }
      this.pipeline.register(
        new ApiKeyPolicy(store, {
          publicRoutes: apiKeyConfig.publicRoutes,
          headerName: apiKeyConfig.headerName,
          cacheTtlSeconds: apiKeyConfig.cacheTtlSeconds,
          cacheMaxEntries: apiKeyConfig.cacheMaxEntries,
        })
      );
      this.pipeline.register(new ConsumerRateLimitPolicy());
      logger.info(
        { consumers: store.stats().consumers, keys: store.stats().keys },
        'API key auth enabled'
      );
    }
    const cacheConfig = config.responseCache;
    if (cfg.audit?.enabled) {
      this.pipeline.register(
        new AuditPolicy({
          includeHeaders: cfg.audit.includeHeaders,
          sampleRate: cfg.audit.sampleRate,
        })
      );
    }
    const recordStore = new RecordStore(cfg.record?.maxEntries ?? 1000);
    if (cfg.replay?.enabled) {
      this.pipeline.register(
        new ReplayPolicy({
          store: recordStore,
          headerName: cfg.replay.headerName,
          maxAgeMs: cfg.replay.maxAgeMs,
        })
      );
    }
    if (cfg.record?.enabled) {
      this.pipeline.register(
        new RecordPolicy({
          store: recordStore,
          maxEntries: cfg.record.maxEntries,
          captureBody: cfg.record.captureBody,
          methods: cfg.record.methods,
        })
      );
    }
    if (cacheConfig?.enabled) {
      this.cache = new ResponseCache();
      this.pipeline.register(new ResponseCachePolicy(this.cache));
    }
    const upstreamConfig = cfg.upstreamCredentials;
    if (upstreamConfig?.enabled && upstreamConfig.credentials?.length) {
      const credentials = new UpstreamCredentialStore(
        upstreamConfig.credentials.map(c => ({
          name: c.name,
          headers: c.headers ?? {},
          hmac: c.hmac,
        }))
      );
      if (upstreamConfig.injection) {
        this.pipeline.register(
          new SetUpStreamHeaderPolicy(credentials, {
            credentialName: upstreamConfig.injection.credentialName,
            publicRoutes: upstreamConfig.injection.publicRoutes,
          })
        );
      }
      if (upstreamConfig.signing) {
        this.pipeline.register(
          new HmacSignPolicy(credentials, {
            credentialName: upstreamConfig.signing.credentialName,
            publicRoutes: upstreamConfig.signing.publicRoutes,
          })
        );
      }
      logger.info(
        { credentials: credentials.stats().credentials },
        'Upstream credential injection enabled'
      );
    }

    // B5: load enabled plugins from config.plugins[] (builtin registry).
    // Custom plugins still register via CLI registerPlugin or plugins.dir.
    const builtinPlugins: Record<string, () => Plugin> = {
      'auth-jwt': () => new AuthJwtPlugin(),
      'header-transformer': () => new HeaderTransformerPlugin(),
      'rate-limit': () => new RateLimitPlugin(),
      'request-id': () => new RequestIdPlugin(),
      'request-logger': () => new RequestLoggerPlugin(),
      'response-time': () => new ResponseTimePlugin(),
    };
    for (const p of config.plugins ?? []) {
      if (!p.enabled) continue;
      const factory = builtinPlugins[p.name];
      if (!factory) {
        logger.warn({ name: p.name }, 'Unknown builtin plugin in config.plugins[] — ignoring');
        continue;
      }
      this.registerPlugin(factory(), p.settings ?? {});
      logger.info({ name: p.name }, 'Plugin loaded from config.plugins[]');
    }
  }

  private setupProxyRouting(config: ConfigFile): void {
    const upstreams: UpstreamTarget[] = (config.upstreams || []).map(u => ({
      id: u.id,
      protocol: (u.protocol as 'http' | 'https') || 'http',
      host: u.host,
      port: u.port,
      basePath: u.basePath || '',
      poolSize: u.poolSize || 10,
      timeout: u.timeout || 30000,
      healthCheck: {
        enabled: u.healthCheck?.enabled ?? false,
        path: u.healthCheck?.path ?? '/health',
        interval: u.healthCheck?.interval ?? 30000,
        timeout: u.healthCheck?.timeout ?? 5000,
        expectedStatus: u.healthCheck?.expectedStatus ?? 200,
        type: 'active' as const,
        gracePeriod: 5000,
        unhealthyThreshold: 3,
        healthyThreshold: 2,
      },
      healthy: true,
      circuitBreaker: CircuitBreakerState.CLOSED,
      weight: 1,
      activeConnections: 0,
    }));

    if (upstreams.length > 0) {
      const proxyCfg = config.proxy;
      const wsEnabled = proxyCfg?.enableWebSocket === true;

      this.proxyHandler = new ProxyHandler({
        enableWebSocket: proxyCfg?.enableWebSocket,
        enableCompression: proxyCfg?.enableCompression,
        enableBodyParsing: config.bodyParser?.enabled,
        bodyParserConfig: config.bodyParser,
        loadBalancerStrategy: config.loadBalancer?.strategy,
        loadBalancerHealthAware: config.loadBalancer?.healthAware,
        enableCircuitBreaker: true,
        circuitBreakerConfig: config.circuitBreaker,
        enableAdvancedMetrics: config.monitoring?.metrics?.enabled,
        streamingThreshold: config.streamingThreshold,
        requestTransformations: config.transforms?.request,
        responseTransformations: config.transforms?.response,
        enableRequestTransformations: !!config.transforms?.request?.length,
        enableResponseTransformations: !!config.transforms?.response?.length,
        enableRetries: !!config.retries,
        retryConfig: config.retries,
      });
      this.proxyHandler.initialize(upstreams);
      this.proxyHandler.setPipeline(this.pipeline);

      if (wsEnabled && this.proxyHandler && this.server) {
        this.proxyHandler.setRouter(this.router);
        this.server.setProxyHandler(this.proxyHandler);
      }

      const reserved = new Set([
        '/',
        '/health',
        '/metrics',
        config.monitoring?.export?.prometheus?.path ?? '',
      ]);
      const declaredRoutes = [...(config.routes || [])];
      const openapiCfg = (config as unknown as WithIdentity).openapi;
      if (openapiCfg?.enabled && openapiCfg.spec) {
        for (const r of routesFromOpenApi(openapiCfg.spec, {
          basePath: openapiCfg.basePath,
          upstreamId: openapiCfg.upstreamId,
        })) {
          declaredRoutes.push({
            method: r.method,
            path: r.path,
            priority: 0,
          } as (typeof declaredRoutes)[number]);
        }
      }
      for (const route of declaredRoutes) {
        if (reserved.has(route.path)) continue;
        this.router.register(route.method, route.path, async ctx => {
          await this.proxyHandler!.handle(ctx);
        });
      }
    } else if (this.proxyHandler) {
      // Reloaded config with no upstreams: drop the handler; the caller
      // (applyConfig) shuts the old instance down.
      this.proxyHandler = null;
      this.server?.setProxyHandler(undefined);
    }
  }

  /**
   * Apply a reloaded config without restarting the listening socket: system
   * and proxy routes plus the pipeline are rebuilt in place. v1 ceiling —
   * server.port/host changes need stop()+start() and are warned, not applied.
   */
  private async applyConfig(cfg: ConfigFile): Promise<void> {
    if (cfg.server?.port !== this.boundPort || cfg.server?.host !== this.boundHost) {
      logger.warn(
        { port: this.boundPort, host: this.boundHost },
        'server.port/host change requires restart — keeping current bind settings'
      );
    }

    const oldProxy = this.proxyHandler;

    // Router and pipeline are registered additively, so a fresh Router and
    // RequestPipeline avoid duplicates on reload. The Server reads both via
    // the same object references (router) or setPipeline (pipeline).
    this.router.clear();
    this.currentConfig = cfg;
    this.registerSystemRoutes();
    this.pipeline = new RequestPipeline();
    if (this.server) this.server.setPipeline(this.pipeline);
    this.setupProxyRouting(cfg);
    this.configurePipeline(cfg);

    if (oldProxy && oldProxy !== this.proxyHandler) {
      await oldProxy.shutdown();
    }
    logger.info('Config reloaded');
  }

  private setupMetricsReporting(): void {
    this.metricsInterval = setInterval(() => {
      logger.info({ metrics: metrics.format() }, 'Metrics snapshot');
    }, 60000);
  }

  private setupShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }
}

// Same realpath discipline as cli.ts: npm .bin shims invoke this file
// through a symlink, so compare resolved paths.
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  const configPath = process.env['CONFIG_PATH'] || './config/gateway.config.json';
  const gateway = new Gateway(configPath);
  gateway.start().catch(error => {
    logger.error({ err: error }, 'Fatal error');
    process.exit(1);
  });
}

export { Server, Router };
export { generateOpenApi, toOpenApiPath } from './core/openapi-generator.js';
export type { OpenApiDoc, OpenApiInfo } from './core/openapi-generator.js';
export * from './types/core.js';
export * from './types/plugin.js';
export * from './types/config.js';
