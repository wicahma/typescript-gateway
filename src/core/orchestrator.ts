/**
 * Master process orchestrator
 * Manages worker threads and load distribution
 */

import { Worker as WorkerThread } from 'worker_threads';
import { cpus } from 'os';
import { GatewayConfig, WorkerMessage, WorkerMessageType } from '../types/core.js';
import { logger } from '../utils/logger.js';

/**
 * Worker info
 */
interface WorkerInfo {
  id: number;
  thread: WorkerThread;
  ready: boolean;
}

/**
 * Orchestrator for managing worker threads
 */
export class Orchestrator {
  private workers: WorkerInfo[] = [];
  private config: GatewayConfig;
  private workerCount: number;

  constructor(config: GatewayConfig) {
    this.config = config;

    // Determine worker count (0 = CPU count)
    this.workerCount = config.performance.workerCount || cpus().length;
  }

  /**
   * Start orchestrator and spawn workers
   */
  async start(): Promise<void> {
    logger.info({ workerCount: this.workerCount }, 'Starting orchestrator');

    // Spawn worker threads
    for (let i = 0; i < this.workerCount; i++) {
      await this.spawnWorker(i);
    }

    logger.info('All workers started');
  }

  /**
   * Spawn a single worker thread
   */
  private async spawnWorker(id: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = new WorkerThread('./dist/core/worker.js', {
        workerData: { config: this.config },
      });

      const workerInfo: WorkerInfo = {
        id,
        thread: worker,
        ready: false,
      };

      // Handle worker messages
      worker.on('message', (message: WorkerMessage) => {
        this.handleWorkerMessage(workerInfo, message);

        if (message.type === WorkerMessageType.INIT && message.payload) {
          const payload = message.payload as { status: string };
          if (payload.status === 'ready') {
            workerInfo.ready = true;
            resolve();
          }
        }
      });

      // Handle worker errors
      worker.on('error', error => {
        logger.error({ workerId: id, err: error }, 'Worker error');
        reject(error);
      });

      // Handle worker exit
      worker.on('exit', code => {
        if (code !== 0) {
          logger.error({ workerId: id, exitCode: code }, 'Worker exited with error');
        } else {
          logger.info({ workerId: id }, 'Worker exited');
        }

        // Remove from workers list
        this.workers = this.workers.filter(w => w.id !== id);
      });

      this.workers.push(workerInfo);

      // Send initialization message
      this.sendToWorker(workerInfo, {
        type: WorkerMessageType.INIT,
        payload: this.config,
        timestamp: Date.now(),
      });
    });
  }

  /**
   * Handle message from worker
   */
  private handleWorkerMessage(worker: WorkerInfo, message: WorkerMessage): void {
    switch (message.type) {
      case WorkerMessageType.METRICS_RESPONSE:
        // Aggregate metrics from workers
        logger.debug({ workerId: worker.id, metrics: message.payload }, 'Worker metrics');
        break;

      case WorkerMessageType.HEALTH_CHECK:
        logger.debug({ workerId: worker.id, health: message.payload }, 'Worker health');
        break;

      default:
        logger.debug({ workerId: worker.id, type: message.type }, 'Worker message');
    }
  }

  /**
   * Send message to specific worker
   */
  private sendToWorker(worker: WorkerInfo, message: WorkerMessage): void {
    worker.thread.postMessage(message);
  }

  /**
   * Broadcast message to all workers
   */
  broadcast(message: WorkerMessage): void {
    for (const worker of this.workers) {
      this.sendToWorker(worker, message);
    }
  }

  /**
   * Update configuration for all workers
   */
  async updateConfig(config: GatewayConfig): Promise<void> {
    this.config = config;

    this.broadcast({
      type: WorkerMessageType.CONFIG_UPDATE,
      payload: config,
      timestamp: Date.now(),
    });

    logger.info('Configuration updated for all workers');
  }

  /**
   * Request metrics from all workers
   */
  requestMetrics(): void {
    this.broadcast({
      type: WorkerMessageType.METRICS_REQUEST,
      payload: null,
      timestamp: Date.now(),
    });
  }

  /**
   * Health check all workers
   */
  healthCheck(): void {
    this.broadcast({
      type: WorkerMessageType.HEALTH_CHECK,
      payload: null,
      timestamp: Date.now(),
    });
  }

  /**
   * Shutdown all workers gracefully
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down all workers');

    this.broadcast({
      type: WorkerMessageType.SHUTDOWN,
      payload: null,
      timestamp: Date.now(),
    });

    // Wait for workers to exit
    await Promise.all(
      this.workers.map(
        worker =>
          new Promise<void>(resolve => {
            worker.thread.once('exit', () => resolve());
          })
      )
    );

    logger.info('All workers shut down');
  }

  /**
   * Get worker count
   */
  getWorkerCount(): number {
    return this.workers.length;
  }

  /**
   * Get ready worker count
   */
  getReadyWorkerCount(): number {
    return this.workers.filter(w => w.ready).length;
  }
}
