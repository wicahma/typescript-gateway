/**
 * Worker thread implementation
 * Handles requests in dedicated thread for improved performance
 */

import { parentPort, workerData } from 'worker_threads';
import { WorkerMessage, WorkerMessageType, GatewayConfig } from '../types/core.js';
import { Server } from './server.js';
import { Router } from './router.js';
import { logger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';

/**
 * Worker class for handling requests
 */
export class Worker {
  private server: Server | null = null;
  private router: Router;
  // config stored for future hot reload support
  // @ts-expect-error - config will be used in Phase 2 for hot reload
  private config: GatewayConfig | null = null;

  constructor() {
    this.router = new Router();
    this.setupMessageHandler();
  }

  /**
   * Setup message handler for master-worker communication
   */
  private setupMessageHandler(): void {
    if (!parentPort) {
      throw new Error('Worker must be run in a worker thread');
    }

    parentPort.on('message', async (message: WorkerMessage) => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        logger.error({ err: error }, 'Worker message handler error');
      }
    });
  }

  /**
   * Handle message from master process
   */
  private async handleMessage(message: WorkerMessage): Promise<void> {
    switch (message.type) {
      case WorkerMessageType.INIT:
        await this.initialize(message.payload as GatewayConfig);
        break;

      case WorkerMessageType.CONFIG_UPDATE:
        await this.updateConfig(message.payload as GatewayConfig);
        break;

      case WorkerMessageType.METRICS_REQUEST:
        this.sendMetrics();
        break;

      case WorkerMessageType.HEALTH_CHECK:
        this.sendHealthCheck();
        break;

      case WorkerMessageType.SHUTDOWN:
        await this.shutdown();
        break;

      default:
        logger.warn({ type: message.type }, 'Unknown message type');
    }
  }

  /**
   * Initialize worker with configuration
   */
  private async initialize(config: GatewayConfig): Promise<void> {
    this.config = config;

    // Register routes
    if (config.routes) {
      for (const route of config.routes) {
        this.router.register(route.method, route.path, route.handler, route.priority);
      }
    }

    // Create server
    this.server = new Server(config.server, this.router);

    logger.info('Worker initialized');
    this.sendMessage({
      type: WorkerMessageType.INIT,
      payload: { status: 'ready' },
      timestamp: Date.now(),
    });
  }

  /**
   * Update worker configuration
   */
  private async updateConfig(config: GatewayConfig): Promise<void> {
    this.config = config;
    // TODO: Hot reload routes and configuration
    logger.info('Worker configuration updated');
  }

  /**
   * Send metrics to master
   */
  private sendMetrics(): void {
    const snapshot = metrics.snapshot();
    this.sendMessage({
      type: WorkerMessageType.METRICS_RESPONSE,
      payload: snapshot,
      timestamp: Date.now(),
    });
  }

  /**
   * Send health check response
   */
  private sendHealthCheck(): void {
    this.sendMessage({
      type: WorkerMessageType.HEALTH_CHECK,
      payload: { healthy: true },
      timestamp: Date.now(),
    });
  }

  /**
   * Shutdown worker
   */
  private async shutdown(): Promise<void> {
    logger.info('Worker shutting down');

    if (this.server) {
      await this.server.stop();
    }

    process.exit(0);
  }

  /**
   * Send message to master
   */
  private sendMessage(message: WorkerMessage): void {
    if (parentPort) {
      parentPort.postMessage(message);
    }
  }

  /**
   * Start worker server
   */
  async start(): Promise<void> {
    if (!this.server) {
      throw new Error('Worker not initialized');
    }

    await this.server.start();
  }
}

// Auto-start worker if run as worker thread
if (parentPort) {
  const worker = new Worker();

  // Handle initialization data
  if (workerData && workerData.config) {
    worker.start().catch(error => {
      logger.error({ err: error }, 'Worker start error');
      process.exit(1);
    });
  }
}
