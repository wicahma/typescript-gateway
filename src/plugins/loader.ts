/**
 * Plugin loader
 * Dynamically loads and manages gateway plugins
 */

import { readdir } from 'fs/promises';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { Plugin, PluginMetadata, PluginLoaderConfig } from '../types/plugin.js';
import { logger } from '../utils/logger.js';

/**
 * Plugin loader class
 */
export class PluginLoader {
  private plugins: Map<string, Plugin> = new Map();
  private metadata: Map<string, PluginMetadata> = new Map();
  private config: PluginLoaderConfig;

  constructor(config: PluginLoaderConfig) {
    this.config = config;
  }

  /**
   * Load plugin from file path
   */
  async loadPlugin(pluginPath: string, order: number = 0): Promise<Plugin> {
    try {
      // Convert path to file URL for ESM import
      const fileUrl = pathToFileURL(pluginPath).href;

      // Dynamic import
      const module = await import(fileUrl);
      const plugin = module.default || module;

      if (!this.isValidPlugin(plugin)) {
        throw new Error('Invalid plugin: missing required properties');
      }

      // Store plugin
      this.plugins.set(plugin.name, plugin);

      // Store metadata
      const metadata: PluginMetadata = {
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        author: plugin.author,
        enabled: true,
        order,
      };
      this.metadata.set(plugin.name, metadata);

      logger.info({ plugin: plugin.name, version: plugin.version }, 'Plugin loaded');

      return plugin;
    } catch (error) {
      logger.error({ err: error, path: pluginPath }, 'Failed to load plugin');
      throw error;
    }
  }

  /**
   * Load all plugins from directory
   */
  async loadFromDirectory(directory?: string): Promise<Plugin[]> {
    const pluginDir = directory || this.config.pluginDir;
    const plugins: Plugin[] = [];

    try {
      const files = await readdir(pluginDir);
      let order = 0;

      for (const file of files) {
        if (file.endsWith('.js') || file.endsWith('.ts')) {
          const pluginPath = join(pluginDir, file);
          try {
            const plugin = await this.loadPlugin(pluginPath, order++);
            plugins.push(plugin);
          } catch (error) {
            // Continue loading other plugins even if one fails
            logger.warn({ file, err: error }, 'Skipping plugin due to error');
          }
        }
      }
    } catch (error) {
      logger.error({ err: error, directory: pluginDir }, 'Failed to load plugins from directory');
    }

    return plugins;
  }

  /**
   * Get plugin by name
   */
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all loaded plugins
   */
  getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugin metadata
   */
  getMetadata(name: string): PluginMetadata | undefined {
    return this.metadata.get(name);
  }

  /**
   * Get all plugin metadata
   */
  getAllMetadata(): PluginMetadata[] {
    return Array.from(this.metadata.values()).sort((a, b) => a.order - b.order);
  }

  /**
   * Unload plugin
   */
  async unloadPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);

    if (!plugin) {
      throw new Error(`Plugin not found: ${name}`);
    }

    // Call destroy hook if available
    if (plugin.destroy) {
      try {
        await plugin.destroy();
      } catch (error) {
        logger.error({ err: error, plugin: name }, 'Error destroying plugin');
      }
    }

    this.plugins.delete(name);
    this.metadata.delete(name);

    logger.info({ plugin: name }, 'Plugin unloaded');
  }

  /**
   * Unload all plugins
   */
  async unloadAll(): Promise<void> {
    const names = Array.from(this.plugins.keys());

    for (const name of names) {
      await this.unloadPlugin(name);
    }
  }

  /**
   * Validate plugin structure
   */
  private isValidPlugin(plugin: unknown): plugin is Plugin {
    if (!plugin || typeof plugin !== 'object') {
      return false;
    }

    const p = plugin as Partial<Plugin>;

    return (
      typeof p.name === 'string' &&
      typeof p.version === 'string' &&
      typeof p.description === 'string'
    );
  }

  /**
   * Enable plugin
   */
  enablePlugin(name: string): void {
    const metadata = this.metadata.get(name);
    if (metadata) {
      metadata.enabled = true;
    }
  }

  /**
   * Disable plugin
   */
  disablePlugin(name: string): void {
    const metadata = this.metadata.get(name);
    if (metadata) {
      metadata.enabled = false;
    }
  }
}

/**
 * Create plugin loader instance
 */
export function createPluginLoader(config: PluginLoaderConfig): PluginLoader {
  return new PluginLoader(config);
}
