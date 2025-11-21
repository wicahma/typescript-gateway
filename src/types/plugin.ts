/**
 * Plugin system type definitions
 * Defines the contract for gateway plugins
 */

import { RequestContext } from './core.js';

/**
 * Plugin lifecycle hooks
 */
export enum PluginHook {
  /** Called when plugin is loaded */
  INIT = 'init',
  /** Called before request routing */
  PRE_ROUTE = 'preRoute',
  /** Called after route matching, before handler */
  PRE_HANDLER = 'preHandler',
  /** Called after handler, before response */
  POST_HANDLER = 'postHandler',
  /** Called after response is sent */
  POST_RESPONSE = 'postResponse',
  /** Called on request error */
  ON_ERROR = 'onError',
  /** Called when plugin is unloaded */
  DESTROY = 'destroy'
}

/**
 * Plugin interface
 * All plugins must implement this interface
 */
export interface Plugin {
  /** Plugin name (must be unique) */
  name: string;
  /** Plugin version */
  version: string;
  /** Plugin description */
  description: string;
  /** Plugin author */
  author?: string;
  
  /**
   * Initialize plugin
   * Called once during plugin loading
   */
  init?(config: Record<string, unknown>): Promise<void> | void;
  
  /**
   * Pre-route hook
   * Called before route matching
   * Can modify request or short-circuit by setting ctx.responded = true
   */
  preRoute?(ctx: RequestContext): Promise<void> | void;
  
  /**
   * Pre-handler hook
   * Called after route matching, before handler execution
   */
  preHandler?(ctx: RequestContext): Promise<void> | void;
  
  /**
   * Post-handler hook
   * Called after handler execution, before response is sent
   */
  postHandler?(ctx: RequestContext): Promise<void> | void;
  
  /**
   * Post-response hook
   * Called after response is sent
   * Useful for logging, metrics, cleanup
   */
  postResponse?(ctx: RequestContext): Promise<void> | void;
  
  /**
   * Error handler hook
   * Called when an error occurs during request processing
   */
  onError?(ctx: RequestContext, error: Error): Promise<void> | void;
  
  /**
   * Cleanup/destroy hook
   * Called when plugin is unloaded or gateway shuts down
   */
  destroy?(): Promise<void> | void;
}

/**
 * Plugin metadata
 */
export interface PluginMetadata {
  /** Plugin name */
  name: string;
  /** Plugin version */
  version: string;
  /** Plugin description */
  description: string;
  /** Plugin author */
  author?: string;
  /** Whether plugin is enabled */
  enabled: boolean;
  /** Plugin load order (lower = earlier) */
  order: number;
}

/**
 * Plugin execution context
 * Used internally by plugin executor
 */
export interface PluginExecutionContext {
  /** Plugin instance */
  plugin: Plugin;
  /** Plugin metadata */
  metadata: PluginMetadata;
  /** Plugin configuration */
  config: Record<string, unknown>;
  /** Execution statistics */
  stats: PluginStats;
}

/**
 * Plugin execution statistics
 */
export interface PluginStats {
  /** Total invocations */
  invocations: number;
  /** Total errors */
  errors: number;
  /** Average execution time in microseconds */
  avgExecutionTime: number;
  /** Max execution time in microseconds */
  maxExecutionTime: number;
}

/**
 * Plugin loader configuration
 */
export interface PluginLoaderConfig {
  /** Plugin directory path */
  pluginDir: string;
  /** Auto-load plugins from directory */
  autoLoad: boolean;
  /** Plugin load timeout in milliseconds */
  loadTimeout: number;
  /** Enable plugin hot reload */
  hotReload: boolean;
}
