import { Server } from './core/server.js';
import { Router } from './core/router.js';
import { ProxyHandler } from './core/proxy-handler.js';
import { createConfigLoader } from './config/loader.js';
import { logger } from './utils/logger.js';
import { metrics } from './utils/metrics.js';
import { ConfigFile } from './types/config.js';
import { AuthJwtPlugin, AuthJwtConfig } from './plugins/builtin/auth-jwt.js';
import { UpstreamTarget, CircuitBreakerState } from './types/core.js';

export class Gateway {
  private server: Server | null = null;
  private router: Router;
  private proxyHandler: ProxyHandler | null = null;
  private configLoader;
  private metricsInterval: NodeJS.Timeout | null = null;
  private authPlugin: AuthJwtPlugin | null = null;

  constructor(configPath: string) {
    this.router = new Router();
    this.configLoader = createConfigLoader({
      configPath,
      hotReload: false,
      reloadInterval: 5000,
      validate: true,
    });
  }

  async start(): Promise<void> {
    const config = await this.configLoader.load();
    this.registerSystemRoutes();
    this.setupProxyRouting(config);
    this.configureAuth(config);

    const serverConfig = {
      ...config.server,
      port: Number(process.env['PORT']) || config.server.port,
      host: process.env['HOST'] || config.server.host,
    };

    this.server = new Server(serverConfig, this.router);
    if (this.authPlugin) {
      this.server.setPreRouteHook((ctx) => this.authPlugin!.preRoute(ctx));
    }
    await this.server.start();

    this.setupMetricsReporting();
    this.setupShutdownHandlers();
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

  getServer(): Server | null {
    return this.server;
  }

  private registerSystemRoutes(): void {
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

    this.router.register('GET', '/metrics', async ctx => {
      ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify(metrics.snapshot(), null, 2));
      ctx.responded = true;
    });

    this.router.register('GET', '/', async ctx => {
      ctx.res.writeHead(200, { 'Content-Type': 'text/plain' });
      ctx.res.end('TypeScript Service Gateway');
      ctx.responded = true;
    });
  }

  private configureAuth(config: ConfigFile): void {
    const authConfig = (config as unknown as Record<string, unknown>)['auth'] as AuthJwtConfig | undefined;
    if (!authConfig || authConfig.enabled === false) return;
    this.authPlugin = new AuthJwtPlugin(authConfig);
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
      this.proxyHandler = new ProxyHandler();
      this.proxyHandler.initialize(upstreams);

      const reserved = new Set(['/', '/health', '/metrics']);
      for (const route of config.routes || []) {
        if (reserved.has(route.path)) continue;
        this.router.register(route.method, route.path, async ctx => {
          await this.proxyHandler!.handle(ctx);
        });
      }
    }
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const configPath = process.env['CONFIG_PATH'] || './config/gateway.config.json';
  const gateway = new Gateway(configPath);
  gateway.start().catch(error => {
    logger.error({ err: error }, 'Fatal error');
    process.exit(1);
  });
}

export { Server, Router };
export * from './types/core.js';
export * from './types/plugin.js';
export * from './types/config.js';
