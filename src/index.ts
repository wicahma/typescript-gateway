/**
 * Main entry point for the ultra-high-performance API gateway
 * Zero framework dependencies, native Node.js HTTP only
 */

import { Server } from './core/server.js';
import { Router } from './core/router.js';
import { createConfigLoader } from './config/loader.js';
import { logger } from './utils/logger.js';
import { metrics } from './utils/metrics.js';

/**
 * Gateway application
 */
export class Gateway {
  private server: Server | null = null;
  private router: Router;
  private configLoader;
  private metricsInterval: NodeJS.Timeout | null = null;

  constructor(configPath: string) {
    this.router = new Router();
    this.configLoader = createConfigLoader({
      configPath,
      hotReload: false,
      reloadInterval: 5000,
      validate: true,
    });
  }

  /**
   * Start the gateway
   */
  async start(): Promise<void> {
    try {
      // Load configuration
      const config = await this.configLoader.load();
      logger.info({ config: config.version }, 'Configuration loaded');

      // Note: Routes in config are placeholders for Phase 2
      // In Phase 1, routes are registered programmatically
      // Phase 2 will add proxy handlers based on upstream configuration

      // Register example routes for testing
      this.registerDefaultRoutes();

      // Create and start server
      this.server = new Server(config.server, this.router);
      await this.server.start();

      // Setup metrics reporting
      this.setupMetricsReporting();

      // Setup graceful shutdown
      this.setupShutdownHandlers();

      logger.info('Gateway started successfully');
    } catch (error) {
      logger.error({ err: error }, 'Failed to start gateway');
      throw error;
    }
  }

  /**
   * Stop the gateway
   */
  async stop(): Promise<void> {
    logger.info('Stopping gateway');

    // Clear metrics interval
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }

    if (this.server) {
      await this.server.stop();
    }

    this.configLoader.destroy();

    logger.info('Gateway stopped');
  }

  /**
   * Setup periodic metrics reporting
   */
  private setupMetricsReporting(): void {
    this.metricsInterval = setInterval(() => {
      logger.info({ metrics: metrics.format() }, 'Metrics snapshot');
    }, 60000); // Every minute
  }

  /**
   * Setup graceful shutdown handlers
   */
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

  /**
   * Get router instance
   */
  getRouter(): Router {
    return this.router;
  }

  /**
   * Get server instance
   */
  getServer(): Server | null {
    return this.server;
  }

  /**
   * Register default routes for Phase 1 testing
   * Phase 2 will register routes from configuration with proxy handlers
   */
  private registerDefaultRoutes(): void {
    // Health check endpoint
    this.router.register('GET', '/health', async ctx => {
      ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      ctx.responded = true;
    });

    // Metrics endpoint
    this.router.register('GET', '/metrics', async ctx => {
      const snapshot = metrics.snapshot();
      ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify(snapshot, null, 2));
      ctx.responded = true;
    });

    // Root endpoint
    this.router.register('GET', '/', async ctx => {
      ctx.res.writeHead(200, { 'Content-Type': 'text/plain' });
      ctx.res.end('TypeScript Gateway - Phase 1');
      ctx.responded = true;
    });

    logger.info('Default routes registered');
  }
}

/**
 * Start gateway if run directly
 */
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
