import { watch, type FSWatcher } from 'fs';
import { dirname, basename } from 'path';
import { ConfigFile } from '../types/config.js';
import { ConfigValidator, configValidator } from './validator.js';
import { interpolateConfig } from './interpolation.js';
import { logger } from '../utils/logger.js';

const DEFAULT_SERVER = { keepAlive: true, keepAliveTimeout: 65000, requestTimeout: 30000, maxHeaderSize: 16384, maxBodySize: 10485760 };

export class ConfigLoader {
  private config: ConfigFile | null = null;
  private readonly validator: ConfigValidator = configValidator;
  private watcher: FSWatcher | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;
  private reloadHandler: ((cfg: ConfigFile) => void | Promise<void>) | null = null;

  constructor(
    private readonly options: {
      configPath: string;
      validate?: boolean;
      interpolate?: boolean;
      hotReload?: boolean;
      reloadInterval?: number;
    }
  ) {
    if (options.hotReload) {
      this.startWatching();
    }
  }

  async load(): Promise<ConfigFile> {
    const { readFile } = await import('fs/promises');
    const content = await readFile(this.options.configPath, 'utf-8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      throw new Error(`Invalid JSON in configuration file: ${(e as Error).message}`);
    }

    let cfg = parsed as ConfigFile;
    if (this.options.interpolate) {
      cfg = interpolateConfig(cfg, { strict: false }) as ConfigFile;
    }
    if (this.options.validate !== false) {
      this.validator.validateOrThrow(cfg);
    }

    this.config = {
      ...cfg,
      server: { ...DEFAULT_SERVER, ...cfg.server },
    };
    return this.config;
  }

  /**
   * Re-read + validate + interpolate the config file, then notify the reload
   * handler (set via setReloadHandler). Used by the watcher and available
   * for manual reloads.
   */
  async reload(): Promise<ConfigFile> {
    const cfg = await this.load();
    if (this.reloadHandler) {
      try {
        await this.reloadHandler(cfg);
      } catch (err) {
        logger.error({ err }, 'Config reload handler failed');
      }
    }
    return cfg;
  }

  /** Register a callback invoked after a successful reload(). */
  setReloadHandler(handler: (cfg: ConfigFile) => void | Promise<void>): void {
    this.reloadHandler = handler;
  }

  /** Watch the config file (debounced by reloadInterval) and reload on change. */
  startWatching(reloadInterval?: number): void {
    if (this.watcher) return;
    const interval = reloadInterval ?? this.options.reloadInterval ?? 100;
    const dir = dirname(this.options.configPath);
    const file = basename(this.options.configPath);
    try {
      this.watcher = watch(dir, { persistent: false }, (_event, filename) => {
        if (filename && String(filename) !== file) return;
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => {
          this.reloadTimer = null;
          this.reload().catch(err => logger.error({ err }, 'Config hot reload failed'));
        }, interval);
      });
      logger.info({ configPath: this.options.configPath, interval }, 'Config hot reload enabled');
    } catch (err) {
      logger.error({ err }, 'Config hot reload watcher failed to start');
    }
  }

  getConfig(): ConfigFile | null {
    return this.config;
  }

  destroy(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.config = null;
    this.reloadHandler = null;
  }
}

export function createConfigLoader(options: {
  configPath: string;
  validate?: boolean;
  interpolate?: boolean;
  hotReload?: boolean;
  reloadInterval?: number;
  defaults?: Partial<ConfigFile>;
}): ConfigLoader {
  return new ConfigLoader({
    configPath: options.configPath,
    validate: options.validate,
    interpolate: options.interpolate,
    hotReload: options.hotReload,
    reloadInterval: options.reloadInterval,
  });
}
