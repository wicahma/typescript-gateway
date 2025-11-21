/**
 * Plugin executor
 * Executes plugin hooks in correct order with error handling
 */

import { Plugin, PluginHook, PluginExecutionContext, PluginStats } from '../types/plugin.js';
import { RequestContext } from '../types/core.js';
import { logger } from '../utils/logger.js';

/**
 * Plugin executor class
 */
export class PluginExecutor {
  private contexts: Map<string, PluginExecutionContext> = new Map();

  /**
   * Register plugin for execution
   */
  register(plugin: Plugin, config: Record<string, unknown> = {}): void {
    const stats: PluginStats = {
      invocations: 0,
      errors: 0,
      avgExecutionTime: 0,
      maxExecutionTime: 0,
    };

    const context: PluginExecutionContext = {
      plugin,
      metadata: {
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        author: plugin.author,
        enabled: true,
        order: 0,
      },
      config,
      stats,
    };

    this.contexts.set(plugin.name, context);
  }

  /**
   * Initialize all plugins
   */
  async initializeAll(): Promise<void> {
    for (const context of this.contexts.values()) {
      if (context.plugin.init && context.metadata.enabled) {
        try {
          await context.plugin.init(context.config);
          logger.info({ plugin: context.plugin.name }, 'Plugin initialized');
        } catch (error) {
          logger.error({ err: error, plugin: context.plugin.name }, 'Plugin init error');
        }
      }
    }
  }

  /**
   * Execute hook for all plugins
   */
  async executeHook(hook: PluginHook, ctx: RequestContext, error?: Error): Promise<void> {
    for (const context of this.contexts.values()) {
      if (!context.metadata.enabled) {
        continue;
      }

      const startTime = process.hrtime.bigint();

      try {
        context.stats.invocations++;

        switch (hook) {
          case PluginHook.PRE_ROUTE:
            if (context.plugin.preRoute) {
              await context.plugin.preRoute(ctx);
            }
            break;

          case PluginHook.PRE_HANDLER:
            if (context.plugin.preHandler) {
              await context.plugin.preHandler(ctx);
            }
            break;

          case PluginHook.POST_HANDLER:
            if (context.plugin.postHandler) {
              await context.plugin.postHandler(ctx);
            }
            break;

          case PluginHook.POST_RESPONSE:
            if (context.plugin.postResponse) {
              await context.plugin.postResponse(ctx);
            }
            break;

          case PluginHook.ON_ERROR:
            if (context.plugin.onError && error) {
              await context.plugin.onError(ctx, error);
            }
            break;
        }

        // Update execution time statistics
        const endTime = process.hrtime.bigint();
        const executionTime = Number(endTime - startTime) / 1000; // microseconds

        context.stats.avgExecutionTime =
          (context.stats.avgExecutionTime * (context.stats.invocations - 1) + executionTime) /
          context.stats.invocations;

        if (executionTime > context.stats.maxExecutionTime) {
          context.stats.maxExecutionTime = executionTime;
        }
      } catch (err) {
        context.stats.errors++;
        logger.error(
          {
            err,
            plugin: context.plugin.name,
            hook,
          },
          'Plugin execution error'
        );
      }
    }
  }

  /**
   * Execute pre-route hooks
   */
  async preRoute(ctx: RequestContext): Promise<void> {
    await this.executeHook(PluginHook.PRE_ROUTE, ctx);
  }

  /**
   * Execute pre-handler hooks
   */
  async preHandler(ctx: RequestContext): Promise<void> {
    await this.executeHook(PluginHook.PRE_HANDLER, ctx);
  }

  /**
   * Execute post-handler hooks
   */
  async postHandler(ctx: RequestContext): Promise<void> {
    await this.executeHook(PluginHook.POST_HANDLER, ctx);
  }

  /**
   * Execute post-response hooks
   */
  async postResponse(ctx: RequestContext): Promise<void> {
    await this.executeHook(PluginHook.POST_RESPONSE, ctx);
  }

  /**
   * Execute error hooks
   */
  async onError(ctx: RequestContext, error: Error): Promise<void> {
    await this.executeHook(PluginHook.ON_ERROR, ctx, error);
  }

  /**
   * Destroy all plugins
   */
  async destroyAll(): Promise<void> {
    for (const context of this.contexts.values()) {
      if (context.plugin.destroy) {
        try {
          await context.plugin.destroy();
          logger.info({ plugin: context.plugin.name }, 'Plugin destroyed');
        } catch (error) {
          logger.error({ err: error, plugin: context.plugin.name }, 'Plugin destroy error');
        }
      }
    }
  }

  /**
   * Get plugin statistics
   */
  getStats(pluginName: string): PluginStats | undefined {
    return this.contexts.get(pluginName)?.stats;
  }

  /**
   * Get all plugin statistics
   */
  getAllStats(): Map<string, PluginStats> {
    const stats = new Map<string, PluginStats>();
    this.contexts.forEach((context, name) => {
      stats.set(name, context.stats);
    });
    return stats;
  }

  /**
   * Enable plugin
   */
  enablePlugin(name: string): void {
    const context = this.contexts.get(name);
    if (context) {
      context.metadata.enabled = true;
    }
  }

  /**
   * Disable plugin
   */
  disablePlugin(name: string): void {
    const context = this.contexts.get(name);
    if (context) {
      context.metadata.enabled = false;
    }
  }

  /**
   * Clear all plugins
   */
  clear(): void {
    this.contexts.clear();
  }
}

/**
 * Create plugin executor instance
 */
export function createPluginExecutor(): PluginExecutor {
  return new PluginExecutor();
}
