/**
 * Configuration type definitions
 * Separating config types for better organization
 */

import { 
  GatewayConfig, 
  ServerConfig, 
  PerformanceConfig,
  UpstreamTarget,
  Route 
} from './core.js';
import { PluginConfig } from './core.js';

/**
 * Configuration file format
 */
export interface ConfigFile extends GatewayConfig {
  /** Configuration version */
  version: string;
  /** Environment (development, production, etc.) */
  environment: string;
}

/**
 * Configuration validation result
 */
export interface ValidationResult {
  /** Whether configuration is valid */
  valid: boolean;
  /** Validation errors */
  errors: ValidationError[];
}

/**
 * Configuration validation error
 */
export interface ValidationError {
  /** Path to invalid field */
  path: string;
  /** Error message */
  message: string;
  /** Error code */
  code: string;
}

/**
 * Configuration loader options
 */
export interface ConfigLoaderOptions {
  /** Configuration file path */
  configPath: string;
  /** Enable hot reload */
  hotReload: boolean;
  /** Hot reload interval in milliseconds */
  reloadInterval: number;
  /** Validate on load */
  validate: boolean;
  /** Default configuration (fallback) */
  defaults?: Partial<GatewayConfig>;
}

/**
 * Configuration change event
 */
export interface ConfigChangeEvent {
  /** Event type */
  type: 'added' | 'modified' | 'removed';
  /** Configuration path that changed */
  path: string;
  /** Old value */
  oldValue: unknown;
  /** New value */
  newValue: unknown;
  /** Timestamp */
  timestamp: number;
}

/**
 * Configuration watcher callback
 */
export type ConfigWatcherCallback = (event: ConfigChangeEvent) => void | Promise<void>;

export type {
  GatewayConfig,
  ServerConfig,
  PerformanceConfig,
  UpstreamTarget,
  Route,
  PluginConfig
};
