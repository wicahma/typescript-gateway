/**
 * Cleanup Manager for Phase 7: Resilience & Error Handling
 * 
 * Tracks and manages resource cleanup for connections, timers, streams, and event listeners
 * Performance target: < 1ms for cleanup operations
 */

import { logger } from '../utils/logger.js';
import { EventEmitter } from 'events';

/**
 * Resource types
 */
export enum ResourceType {
  TIMER = 'timer',
  CONNECTION = 'connection',
  STREAM = 'stream',
  EVENT_LISTENER = 'event_listener',
  ABORT_CONTROLLER = 'abort_controller',
  OTHER = 'other',
}

/**
 * Resource tracking entry
 */
interface Resource {
  /** Resource ID */
  id: string;
  /** Resource type */
  type: ResourceType;
  /** Creation timestamp */
  createdAt: number;
  /** Cleanup function */
  cleanup: () => void | Promise<void>;
  /** Whether resource has been cleaned up */
  cleaned: boolean;
  /** Associated request ID */
  requestId?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Cleanup statistics
 */
export interface CleanupStats {
  /** Total resources tracked */
  totalTracked: number;
  /** Total resources cleaned up */
  totalCleaned: number;
  /** Currently active resources */
  activeResources: number;
  /** Resources by type */
  byType: Record<ResourceType, number>;
  /** Potential leaks (active resources older than threshold) */
  potentialLeaks: number;
  /** Total cleanup time in milliseconds */
  totalCleanupTime: number;
  /** Average cleanup time in milliseconds */
  avgCleanupTime: number;
}

/**
 * Cleanup configuration
 */
export interface CleanupConfig {
  /** Enable resource leak detection */
  enableLeakDetection: boolean;
  /** Resource age threshold for leak detection in milliseconds */
  leakDetectionThreshold: number;
  /** Enable automatic cleanup on timeout */
  autoCleanupOnTimeout: boolean;
  /** Enable cleanup metrics */
  enableMetrics: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: CleanupConfig = {
  enableLeakDetection: process.env['NODE_ENV'] === 'development',
  leakDetectionThreshold: 60000, // 1 minute
  autoCleanupOnTimeout: true,
  enableMetrics: true,
};

/**
 * Cleanup Manager
 */
export class CleanupManager {
  private config: CleanupConfig;
  private resources: Map<string, Resource> = new Map();
  private resourcesByRequest: Map<string, Set<string>> = new Map();
  private totalTracked = 0;
  private totalCleaned = 0;
  private totalCleanupTime = 0;
  private cleanupCount = 0;
  private resourceCountByType: Map<ResourceType, number> = new Map();

  constructor(config?: Partial<CleanupConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeStats();

    // Start periodic leak detection
    if (this.config.enableLeakDetection) {
      this.startLeakDetection();
    }
  }

  /**
   * Initialize statistics
   */
  private initializeStats(): void {
    for (const type of Object.values(ResourceType)) {
      this.resourceCountByType.set(type as ResourceType, 0);
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CleanupConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Track a resource
   */
  track(
    type: ResourceType,
    cleanup: () => void | Promise<void>,
    requestId?: string,
    metadata?: Record<string, unknown>
  ): string {
    const resourceId = this.generateResourceId();

    const resource: Resource = {
      id: resourceId,
      type,
      createdAt: Date.now(),
      cleanup,
      cleaned: false,
      requestId,
      metadata,
    };

    this.resources.set(resourceId, resource);
    this.totalTracked++;

    // Track by type
    const typeCount = this.resourceCountByType.get(type) || 0;
    this.resourceCountByType.set(type, typeCount + 1);

    // Track by request
    if (requestId) {
      let requestResources = this.resourcesByRequest.get(requestId);
      if (!requestResources) {
        requestResources = new Set();
        this.resourcesByRequest.set(requestId, requestResources);
      }
      requestResources.add(resourceId);
    }

    return resourceId;
  }

  /**
   * Track a timer
   */
  trackTimer(
    timerId: NodeJS.Timeout,
    requestId?: string,
    metadata?: Record<string, unknown>
  ): string {
    return this.track(
      ResourceType.TIMER,
      () => clearTimeout(timerId),
      requestId,
      metadata
    );
  }

  /**
   * Track a stream
   */
  trackStream(
    stream: NodeJS.ReadableStream | NodeJS.WritableStream,
    requestId?: string,
    metadata?: Record<string, unknown>
  ): string {
    return this.track(
      ResourceType.STREAM,
      () => {
        if ('destroy' in stream && typeof stream.destroy === 'function') {
          stream.destroy();
        }
      },
      requestId,
      metadata
    );
  }

  /**
   * Track an event listener
   */
  trackEventListener(
    emitter: EventEmitter,
    event: string,
    listener: (...args: unknown[]) => void,
    requestId?: string,
    metadata?: Record<string, unknown>
  ): string {
    return this.track(
      ResourceType.EVENT_LISTENER,
      () => {
        emitter.removeListener(event, listener);
      },
      requestId,
      { ...metadata, event }
    );
  }

  /**
   * Track an AbortController
   */
  trackAbortController(
    controller: AbortController,
    requestId?: string,
    metadata?: Record<string, unknown>
  ): string {
    return this.track(
      ResourceType.ABORT_CONTROLLER,
      () => {
        if (!controller.signal.aborted) {
          controller.abort();
        }
      },
      requestId,
      metadata
    );
  }

  /**
   * Cleanup a specific resource
   */
  async cleanup(resourceId: string): Promise<void> {
    const startTime = process.hrtime.bigint();
    const resource = this.resources.get(resourceId);

    if (!resource || resource.cleaned) {
      return;
    }

    try {
      await resource.cleanup();
      resource.cleaned = true;
      this.totalCleaned++;
      this.cleanupCount++;

      // Update type count
      const typeCount = this.resourceCountByType.get(resource.type) || 0;
      this.resourceCountByType.set(resource.type, Math.max(0, typeCount - 1));

      // Remove from tracking
      this.resources.delete(resourceId);

      // Remove from request tracking
      if (resource.requestId) {
        const requestResources = this.resourcesByRequest.get(resource.requestId);
        if (requestResources) {
          requestResources.delete(resourceId);
          if (requestResources.size === 0) {
            this.resourcesByRequest.delete(resource.requestId);
          }
        }
      }

      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      
      if (this.config.enableMetrics) {
        this.totalCleanupTime += duration;
      }

      if (duration > 1.0) {
        logger.warn(
          `Resource cleanup took ${duration.toFixed(3)}ms (target: < 1ms) for ${resource.type}`
        );
      }
    } catch (error) {
      logger.error(`Failed to cleanup resource ${resourceId}: ${error}`);
    }
  }

  /**
   * Cleanup all resources for a request
   */
  async cleanupRequest(requestId: string): Promise<void> {
    const resourceIds = this.resourcesByRequest.get(requestId);
    if (!resourceIds) {
      return;
    }

    const cleanupPromises: Promise<void>[] = [];
    for (const resourceId of resourceIds) {
      cleanupPromises.push(this.cleanup(resourceId));
    }

    await Promise.all(cleanupPromises);
  }

  /**
   * Cleanup all resources
   */
  async cleanupAll(): Promise<void> {
    const resourceIds = Array.from(this.resources.keys());
    const cleanupPromises = resourceIds.map((id) => this.cleanup(id));
    await Promise.all(cleanupPromises);
  }

  /**
   * Get active resources for request
   */
  getActiveResources(requestId?: string): Resource[] {
    if (requestId) {
      const resourceIds = this.resourcesByRequest.get(requestId);
      if (!resourceIds) {
        return [];
      }
      return Array.from(resourceIds)
        .map((id) => this.resources.get(id))
        .filter((r): r is Resource => r !== undefined && !r.cleaned);
    }

    return Array.from(this.resources.values()).filter((r) => !r.cleaned);
  }

  /**
   * Detect potential resource leaks
   */
  detectLeaks(): Resource[] {
    if (!this.config.enableLeakDetection) {
      return [];
    }

    const now = Date.now();
    const threshold = this.config.leakDetectionThreshold;
    const leaks: Resource[] = [];

    for (const resource of this.resources.values()) {
      if (!resource.cleaned && now - resource.createdAt > threshold) {
        leaks.push(resource);
      }
    }

    if (leaks.length > 0) {
      logger.warn(
        `Detected ${leaks.length} potential resource leaks (threshold: ${threshold}ms)`
      );
    }

    return leaks;
  }

  /**
   * Start periodic leak detection
   */
  private startLeakDetection(): void {
    // Check for leaks every minute
    const interval = setInterval(() => {
      this.detectLeaks();
    }, 60000);

    // Don't prevent process from exiting
    interval.unref();
  }

  /**
   * Get statistics
   */
  getStats(): CleanupStats {
    const activeResources = this.resources.size;
    const potentialLeaks = this.detectLeaks().length;

    const byType: Record<ResourceType, number> = {
      [ResourceType.TIMER]: this.resourceCountByType.get(ResourceType.TIMER) || 0,
      [ResourceType.CONNECTION]: this.resourceCountByType.get(ResourceType.CONNECTION) || 0,
      [ResourceType.STREAM]: this.resourceCountByType.get(ResourceType.STREAM) || 0,
      [ResourceType.EVENT_LISTENER]: this.resourceCountByType.get(ResourceType.EVENT_LISTENER) || 0,
      [ResourceType.ABORT_CONTROLLER]: this.resourceCountByType.get(ResourceType.ABORT_CONTROLLER) || 0,
      [ResourceType.OTHER]: this.resourceCountByType.get(ResourceType.OTHER) || 0,
    };

    return {
      totalTracked: this.totalTracked,
      totalCleaned: this.totalCleaned,
      activeResources,
      byType,
      potentialLeaks,
      totalCleanupTime: this.totalCleanupTime,
      avgCleanupTime:
        this.cleanupCount > 0 ? this.totalCleanupTime / this.cleanupCount : 0,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.totalTracked = 0;
    this.totalCleaned = 0;
    this.totalCleanupTime = 0;
    this.cleanupCount = 0;
    this.initializeStats();
  }

  /**
   * Generate unique resource ID
   */
  private generateResourceId(): string {
    return `res-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Destroy manager and cleanup all resources
   */
  async destroy(): Promise<void> {
    await this.cleanupAll();
    this.resources.clear();
    this.resourcesByRequest.clear();
    logger.info('Cleanup manager destroyed');
  }
}
