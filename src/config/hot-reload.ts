/**
 * Configuration hot reload mechanism
 * Implements file watching with debouncing and graceful transitions
 */

import { watch, FSWatcher } from 'fs';
import { readFile } from 'fs/promises';
import { EventEmitter } from 'events';
import { ConfigFile } from '../types/config.js';
import { configValidator } from './validator.js';
import { interpolateConfig } from './interpolation.js';
import { configVersionManager } from './versioning.js';
import { logger } from '../utils/logger.js';

/**
 * Hot reload event types
 */
export enum HotReloadEvent {
  RELOADING = 'reloading',
  RELOADED = 'reloaded',
  ERROR = 'error',
  VALIDATED = 'validated',
  ROLLED_BACK = 'rolled_back',
}

/**
 * Hot reload options
 */
export interface HotReloadOptions {
  /** Configuration file path */
  configPath: string;
  /** Debounce time in milliseconds (default: 300ms) */
  debounceMs: number;
  /** Enable validation before applying */
  validate: boolean;
  /** Enable automatic rollback on validation failure */
  rollbackOnError: boolean;
  /** Enable environment variable interpolation */
  interpolate: boolean;
}

/**
 * Hot reload event data
 */
export interface HotReloadEventData {
  /** Event type */
  event: HotReloadEvent;
  /** Configuration path */
  path: string;
  /** New configuration (if available) */
  config?: ConfigFile;
  /** Error (if any) */
  error?: Error;
  /** Timestamp */
  timestamp: number;
}

/**
 * Configuration hot reload manager
 * Watches configuration file and reloads on changes with debouncing
 */
export class HotReloadManager extends EventEmitter {
  private options: HotReloadOptions;
  private watcher: FSWatcher | null = null;
  private currentConfig: ConfigFile | null = null;
  private previousConfig: ConfigFile | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private isReloading = false;
  private reloadCount = 0;
  
  constructor(options: Partial<HotReloadOptions> & { configPath: string }) {
    super();
    this.options = {
      debounceMs: 300,
      validate: true,
      rollbackOnError: true,
      interpolate: true,
      ...options,
    };
  }
  
  /**
   * Start watching configuration file
   */
  start(initialConfig: ConfigFile): void {
    if (this.watcher) {
      throw new Error('Hot reload is already started');
    }
    
    this.currentConfig = initialConfig;
    this.previousConfig = initialConfig;
    
    this.watcher = watch(this.options.configPath, (eventType) => {
      if (eventType === 'change') {
        this.scheduleReload();
      }
    });
    
    this.watcher.on('error', (error) => {
      this.emitEvent(HotReloadEvent.ERROR, { error });
    });
    
    logger.info(
      { path: this.options.configPath, debounceMs: this.options.debounceMs },
      'Hot reload started'
    );
  }
  
  /**
   * Stop watching configuration file
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    
    logger.info('Hot reload stopped');
  }
  
  /**
   * Schedule a reload with debouncing
   * Multiple rapid file changes will be coalesced into a single reload
   */
  private scheduleReload(): void {
    // Clear existing timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    // Schedule new reload
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.reload();
    }, this.options.debounceMs);
  }
  
  /**
   * Reload configuration from file
   */
  private async reload(): Promise<void> {
    if (this.isReloading) {
      logger.warn('Reload already in progress, skipping');
      return;
    }
    
    this.isReloading = true;
    this.reloadCount++;
    
    const startTime = Date.now();
    
    try {
      // Emit reloading event
      this.emitEvent(HotReloadEvent.RELOADING, {});
      
      // Load new configuration
      const content = await readFile(this.options.configPath, 'utf-8');
      let newConfig = JSON.parse(content) as ConfigFile;
      
      // Apply environment variable interpolation
      if (this.options.interpolate) {
        newConfig = interpolateConfig(newConfig, { strict: false });
      }
      
      // Validate configuration version
      const versionValidation = configVersionManager.validateVersion(newConfig);
      if (!versionValidation.valid) {
        throw new Error(`Version validation failed: ${versionValidation.errors.join(', ')}`);
      }
      
      // Migrate if needed
      if (newConfig.version !== configVersionManager.getCurrentVersion()) {
        logger.info(
          { from: newConfig.version, to: configVersionManager.getCurrentVersion() },
          'Migrating configuration'
        );
        newConfig = configVersionManager.migrateToCurrentVersion(newConfig);
      }
      
      // Validate new configuration
      if (this.options.validate) {
        configValidator.validateOrThrow(newConfig);
        this.emitEvent(HotReloadEvent.VALIDATED, { config: newConfig });
      }
      
      // Save previous config for potential rollback
      this.previousConfig = this.currentConfig;
      
      // Apply new configuration
      this.currentConfig = newConfig;
      
      const duration = Date.now() - startTime;
      
      logger.info(
        {
          reloadCount: this.reloadCount,
          durationMs: duration,
          version: newConfig.version,
        },
        'Configuration reloaded successfully'
      );
      
      // Emit reloaded event
      this.emitEvent(HotReloadEvent.RELOADED, { config: newConfig });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      
      logger.error(
        {
          err,
          path: this.options.configPath,
          reloadCount: this.reloadCount,
        },
        'Configuration reload failed'
      );
      
      // Rollback if enabled
      if (this.options.rollbackOnError && this.previousConfig) {
        logger.info('Rolling back to previous configuration');
        this.currentConfig = this.previousConfig;
        this.emitEvent(HotReloadEvent.ROLLED_BACK, { config: this.previousConfig });
      }
      
      // Emit error event
      this.emitEvent(HotReloadEvent.ERROR, { error: err });
    } finally {
      this.isReloading = false;
    }
  }
  
  /**
   * Get current configuration
   */
  getCurrentConfig(): ConfigFile | null {
    return this.currentConfig;
  }
  
  /**
   * Get previous configuration
   */
  getPreviousConfig(): ConfigFile | null {
    return this.previousConfig;
  }
  
  /**
   * Get reload count
   */
  getReloadCount(): number {
    return this.reloadCount;
  }
  
  /**
   * Check if currently reloading
   */
  getIsReloading(): boolean {
    return this.isReloading;
  }
  
  /**
   * Emit hot reload event
   */
  private emitEvent(event: HotReloadEvent, data: Partial<HotReloadEventData>): void {
    const eventData: HotReloadEventData = {
      event,
      path: this.options.configPath,
      timestamp: Date.now(),
      ...data,
    };
    
    this.emit(event, eventData);
    this.emit('*', eventData); // Wildcard event for all events
  }
  
  /**
   * Register event listener
   */
  override on(event: HotReloadEvent | '*', listener: (data: HotReloadEventData) => void): this {
    return super.on(event, listener);
  }
  
  /**
   * Register one-time event listener
   */
  override once(event: HotReloadEvent | '*', listener: (data: HotReloadEventData) => void): this {
    return super.once(event, listener);
  }
}

/**
 * Create hot reload manager instance
 */
export function createHotReloadManager(
  options: Partial<HotReloadOptions> & { configPath: string }
): HotReloadManager {
  return new HotReloadManager(options);
}
