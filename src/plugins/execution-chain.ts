/**
 * Optimized plugin execution chain
 * Implements timeout handling, metrics collection, and short-circuit capability
 */

import { Plugin, PluginHook } from '../types/plugin.js';
import { RequestContext } from '../types/core.js';
import { pluginMetricsCollector } from './metrics.js';
import { pluginContextManager } from './context-manager.js';
import { logger } from '../utils/logger.js';

/**
 * Plugin execution options
 */
export interface PluginExecutionOptions {
  /** Timeout in milliseconds (0 = no timeout) */
  timeout: number;
  /** Enable metrics collection */
  collectMetrics: boolean;
  /** Enable result caching */
  enableCaching: boolean;
  /** Short-circuit on first error */
  shortCircuitOnError: boolean;
}

/**
 * Plugin wrapper with execution metadata
 */
interface PluginWrapper {
  plugin: Plugin;
  config: Record<string, unknown>;
  enabled: boolean;
  timeout: number;
  order: number;
}

/**
 * Plugin execution result
 */
export interface PluginExecutionResult {
  /** Plugin name */
  plugin: string;
  /** Hook executed */
  hook: PluginHook;
  /** Execution time in microseconds */
  duration: number;
  /** Whether execution was successful */
  success: boolean;
  /** Error if any */
  error?: Error;
  /** Whether execution timed out */
  timedOut: boolean;
  /** Whether plugin short-circuited the chain */
  shortCircuited: boolean;
}

/**
 * Result cache entry
 */
interface CacheEntry {
  result: unknown;
  timestamp: number;
  ttl: number;
}

/**
 * Optimized plugin execution chain
 * Handles plugin lifecycle with timeouts, metrics, and error boundaries
 */
export class PluginExecutionChain {
  private plugins: Map<string, PluginWrapper> = new Map();
  private defaultOptions: PluginExecutionOptions;
  private resultCache: Map<string, CacheEntry> = new Map();
  private cacheCleanupInterval: NodeJS.Timeout | null = null;
  
  constructor(options?: Partial<PluginExecutionOptions>) {
    this.defaultOptions = {
      timeout: 5000, // 5 second default timeout
      collectMetrics: true,
      enableCaching: false,
      shortCircuitOnError: false,
      ...options,
    };
    
    // Start cache cleanup interval (every 60 seconds)
    if (this.defaultOptions.enableCaching) {
      this.cacheCleanupInterval = setInterval(() => {
        this.cleanExpiredCache();
      }, 60000);
    }
  }
  
  /**
   * Register a plugin
   */
  register(
    plugin: Plugin,
    config: Record<string, unknown> = {},
    options?: { timeout?: number; order?: number }
  ): void {
    const wrapper: PluginWrapper = {
      plugin,
      config,
      enabled: true,
      timeout: options?.timeout ?? this.defaultOptions.timeout,
      order: options?.order ?? this.plugins.size,
    };
    
    this.plugins.set(plugin.name, wrapper);
    
    // Initialize metrics
    if (this.defaultOptions.collectMetrics) {
      pluginMetricsCollector.initialize(plugin.name);
    }
    
    logger.debug({ plugin: plugin.name, order: wrapper.order }, 'Plugin registered');
  }
  
  /**
   * Initialize all plugins
   */
  async initializeAll(): Promise<void> {
    for (const [name, wrapper] of this.plugins.entries()) {
      if (wrapper.plugin.init && wrapper.enabled) {
        try {
          await this.executeWithTimeout(
            () => wrapper.plugin.init?.(wrapper.config),
            wrapper.timeout,
            `${name}.init`
          );
          
          logger.info({ plugin: name }, 'Plugin initialized');
        } catch (error) {
          logger.error({ err: error, plugin: name }, 'Plugin initialization failed');
          // Don't disable plugin on init failure - let it fail at runtime
        }
      }
    }
  }
  
  /**
   * Execute a hook for all plugins
   */
  async executeHook(
    hook: PluginHook,
    ctx: RequestContext,
    error?: Error
  ): Promise<PluginExecutionResult[]> {
    const results: PluginExecutionResult[] = [];
    
    // Initialize plugin context if not already done
    if (!ctx.state['__plugins']) {
      pluginContextManager.initializeContext(ctx, Array.from(this.plugins.keys()));
    }
    
    // Get plugins in execution order
    const orderedPlugins = this.getOrderedPlugins();
    
    for (const wrapper of orderedPlugins) {
      if (!wrapper.enabled) {
        continue;
      }
      
      // Check if request was already responded (short-circuit)
      if (ctx.responded) {
        results.push({
          plugin: wrapper.plugin.name,
          hook,
          duration: 0,
          success: true,
          timedOut: false,
          shortCircuited: true,
        });
        break;
      }
      
      const result = await this.executePluginHook(wrapper, hook, ctx, error);
      results.push(result);
      
      // Short-circuit on error if enabled
      if (!result.success && this.defaultOptions.shortCircuitOnError) {
        logger.warn(
          { plugin: wrapper.plugin.name, hook },
          'Short-circuiting plugin chain due to error'
        );
        break;
      }
    }
    
    return results;
  }
  
  /**
   * Execute a specific plugin hook
   */
  private async executePluginHook(
    wrapper: PluginWrapper,
    hook: PluginHook,
    ctx: RequestContext,
    error?: Error
  ): Promise<PluginExecutionResult> {
    const startTime = process.hrtime.bigint();
    let timedOut = false;
    let executionError: Error | undefined;
    
    try {
      // Get the hook function
      const hookFn = this.getHookFunction(wrapper.plugin, hook);
      
      if (!hookFn) {
        // Plugin doesn't implement this hook
        return {
          plugin: wrapper.plugin.name,
          hook,
          duration: 0,
          success: true,
          timedOut: false,
          shortCircuited: false,
        };
      }
      
      // Execute with timeout
      await this.executeWithTimeout(
        () => hookFn.call(wrapper.plugin, ctx, error),
        wrapper.timeout,
        `${wrapper.plugin.name}.${hook}`
      );
    } catch (err) {
      executionError = err instanceof Error ? err : new Error(String(err));
      timedOut = executionError.message.includes('timed out');
      
      logger.error(
        {
          err: executionError,
          plugin: wrapper.plugin.name,
          hook,
          timedOut,
        },
        'Plugin execution error'
      );
    }
    
    const endTime = process.hrtime.bigint();
    const durationMicros = Number(endTime - startTime) / 1000;
    
    const success = !executionError;
    
    // Record metrics
    if (this.defaultOptions.collectMetrics) {
      pluginMetricsCollector.recordExecution(
        wrapper.plugin.name,
        durationMicros,
        success,
        timedOut
      );
    }
    
    return {
      plugin: wrapper.plugin.name,
      hook,
      duration: durationMicros,
      success,
      error: executionError,
      timedOut,
      shortCircuited: ctx.responded,
    };
  }
  
  /**
   * Get hook function from plugin
   */
  private getHookFunction(
    plugin: Plugin,
    hook: PluginHook
  ): ((ctx: RequestContext, error?: Error) => void | Promise<void>) | undefined {
    switch (hook) {
      case PluginHook.PRE_ROUTE:
        return plugin.preRoute;
      case PluginHook.PRE_HANDLER:
        return plugin.preHandler;
      case PluginHook.POST_HANDLER:
        return plugin.postHandler;
      case PluginHook.POST_RESPONSE:
        return plugin.postResponse;
      case PluginHook.ON_ERROR:
        // Wrap onError to make error parameter optional in the return type
        if (plugin.onError) {
          return (ctx: RequestContext, error?: Error) => {
            if (error) {
              return plugin.onError?.(ctx, error);
            }
          };
        }
        return undefined;
      default:
        return undefined;
    }
  }
  
  /**
   * Execute function with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => T | Promise<T>,
    timeoutMs: number,
    name: string
  ): Promise<T> {
    if (timeoutMs <= 0) {
      // No timeout
      return await fn();
    }
    
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Plugin ${name} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  }
  
  /**
   * Get plugins in execution order
   */
  private getOrderedPlugins(): PluginWrapper[] {
    return Array.from(this.plugins.values()).sort((a, b) => a.order - b.order);
  }
  
  /**
   * Enable a plugin
   */
  enable(name: string): void {
    const wrapper = this.plugins.get(name);
    if (wrapper) {
      wrapper.enabled = true;
      pluginMetricsCollector.enable(name);
      logger.info({ plugin: name }, 'Plugin enabled');
    }
  }
  
  /**
   * Disable a plugin
   */
  disable(name: string): void {
    const wrapper = this.plugins.get(name);
    if (wrapper) {
      wrapper.enabled = false;
      pluginMetricsCollector.disable(name);
      logger.info({ plugin: name }, 'Plugin disabled');
    }
  }
  
  /**
   * Destroy all plugins
   */
  async destroyAll(): Promise<void> {
    for (const [name, wrapper] of this.plugins.entries()) {
      if (wrapper.plugin.destroy) {
        try {
          await this.executeWithTimeout(
            () => wrapper.plugin.destroy?.(),
            wrapper.timeout,
            `${name}.destroy`
          );
          logger.info({ plugin: name }, 'Plugin destroyed');
        } catch (error) {
          logger.error({ err: error, plugin: name }, 'Plugin destroy error');
        }
      }
    }
    
    // Cleanup
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }
    
    this.plugins.clear();
    this.resultCache.clear();
  }
  
  /**
   * Clear result cache
   */
  private cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.resultCache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.resultCache.delete(key);
      }
    }
  }
  
  /**
   * Get all registered plugin names
   */
  getPluginNames(): string[] {
    return Array.from(this.plugins.keys());
  }
  
  /**
   * Check if plugin is registered
   */
  hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }
  
  /**
   * Get plugin count
   */
  getPluginCount(): number {
    return this.plugins.size;
  }
}

/**
 * Create plugin execution chain instance
 */
export function createPluginExecutionChain(
  options?: Partial<PluginExecutionOptions>
): PluginExecutionChain {
  return new PluginExecutionChain(options);
}
