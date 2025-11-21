/**
 * Configuration loader with hot reload support
 * Loads and validates gateway configuration from JSON files
 */

import { readFile, watch } from 'fs/promises';
import { existsSync } from 'fs';
import { EventEmitter } from 'events';
import { configValidator } from './validator.js';
import {
  ConfigFile,
  ConfigLoaderOptions,
  ConfigChangeEvent,
  ConfigWatcherCallback
} from '../types/config.js';

/**
 * Configuration loader with hot reload capability
 */
export class ConfigLoader extends EventEmitter {
  private config: ConfigFile | null = null;
  private options: ConfigLoaderOptions;
  private watchAbortController: AbortController | null = null;

  constructor(options: ConfigLoaderOptions) {
    super();
    this.options = {
      ...options,
      hotReload: options.hotReload ?? false,
      reloadInterval: options.reloadInterval ?? 5000,
      validate: options.validate ?? true
    };
  }

  /**
   * Load configuration from file
   * Validates and applies defaults
   */
  async load(): Promise<ConfigFile> {
    const configPath = this.options.configPath;

    if (!existsSync(configPath)) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }

    try {
      const content = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(content);

      // Validate if enabled
      if (this.options.validate) {
        configValidator.validateOrThrow(parsed);
      }

      // Apply defaults if provided
      if (this.options.defaults) {
        this.config = this.mergeDefaults(parsed, this.options.defaults);
      } else {
        this.config = parsed as ConfigFile;
      }

      // Start watching if hot reload is enabled
      if (this.options.hotReload) {
        await this.startWatching();
      }

      return this.config;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in configuration file: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): ConfigFile | null {
    return this.config;
  }

  /**
   * Reload configuration from file
   */
  async reload(): Promise<ConfigFile> {
    const oldConfig = this.config;
    const newConfig = await this.load();

    // Emit change event if config actually changed
    if (oldConfig && JSON.stringify(oldConfig) !== JSON.stringify(newConfig)) {
      const event: ConfigChangeEvent = {
        type: 'modified',
        path: this.options.configPath,
        oldValue: oldConfig,
        newValue: newConfig,
        timestamp: Date.now()
      };
      this.emit('change', event);
    }

    return newConfig;
  }

  /**
   * Start watching configuration file for changes
   */
  private async startWatching(): Promise<void> {
    if (this.watchAbortController) {
      return; // Already watching
    }

    this.watchAbortController = new AbortController();
    const { signal } = this.watchAbortController;

    try {
      const watcher = watch(this.options.configPath, { signal });

      for await (const event of watcher) {
        if (event.eventType === 'change') {
          try {
            await this.reload();
          } catch (error) {
            this.emit('error', error);
          }
        }
      }
    } catch (error: unknown) {
      // Check if error is AbortError (expected when stopping)
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      this.emit('error', error);
    }
  }

  /**
   * Stop watching configuration file
   */
  stopWatching(): void {
    if (this.watchAbortController) {
      this.watchAbortController.abort();
      this.watchAbortController = null;
    }
  }

  /**
   * Merge configuration with defaults
   */
  private mergeDefaults(config: ConfigFile, defaults: Partial<ConfigFile>): ConfigFile {
    return {
      ...defaults,
      ...config,
      server: {
        ...defaults.server,
        ...config.server
      },
      performance: {
        ...defaults.performance,
        ...config.performance
      }
    } as ConfigFile;
  }

  /**
   * Register callback for configuration changes
   */
  onChange(callback: ConfigWatcherCallback): void {
    this.on('change', callback);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopWatching();
    this.removeAllListeners();
  }
}

/**
 * Create a configuration loader instance
 */
export function createConfigLoader(options: ConfigLoaderOptions): ConfigLoader {
  return new ConfigLoader(options);
}
