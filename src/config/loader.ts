import { ConfigFile } from '../types/config.js';
import { ConfigValidator, configValidator } from './validator.js';
import { interpolateConfig } from './interpolation.js';

const DEFAULT_SERVER = { keepAlive: true, keepAliveTimeout: 65000, requestTimeout: 30000, maxHeaderSize: 16384, maxBodySize: 10485760 };

export class ConfigLoader {
  private config: ConfigFile | null = null;
  private readonly validator: ConfigValidator = configValidator;

  constructor(
    private readonly options: {
      configPath: string;
      validate?: boolean;
      interpolate?: boolean;
    }
  ) {}

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

  getConfig(): ConfigFile | null {
    return this.config;
  }

  destroy(): void {
    this.config = null;
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
  });
}
