/**
 * Plugin context manager
 * Manages namespaced plugin data storage and cross-plugin communication
 */

import { RequestContext } from '../types/core.js';
import { EventEmitter } from 'events';

/**
 * Plugin data namespace
 * Prevents naming collisions between plugins
 */
export interface PluginNamespace {
  /** Namespace identifier (plugin name) */
  namespace: string;
  /** Plugin-specific data */
  data: Record<string, unknown>;
}

/**
 * Plugin event for cross-plugin communication
 */
export interface PluginEvent {
  /** Event name */
  name: string;
  /** Source plugin */
  source: string;
  /** Event payload */
  payload: unknown;
  /** Timestamp */
  timestamp: number;
}

/**
 * Plugin event listener
 */
export type PluginEventListener = (event: PluginEvent) => void | Promise<void>;

/**
 * Plugin context manager
 * Enhances request context with namespaced plugin data storage
 */
export class PluginContextManager {
  private eventBus: EventEmitter = new EventEmitter();
  
  /**
   * Initialize plugin context for a request
   * Creates namespaced storage for plugins
   */
  initializeContext(ctx: RequestContext, pluginNames: string[]): void {
    if (!ctx.state['__plugins']) {
      ctx.state['__plugins'] = new Map<string, Record<string, unknown>>();
    }
    
    // Pre-create namespaces for registered plugins
    const namespaces = ctx.state['__plugins'] as Map<string, Record<string, unknown>>;
    for (const name of pluginNames) {
      if (!namespaces.has(name)) {
        namespaces.set(name, {});
      }
    }
  }
  
  /**
   * Get plugin-specific data from request context
   * Each plugin has its own isolated namespace
   */
  getPluginData<T = Record<string, unknown>>(ctx: RequestContext, pluginName: string): T {
    const namespaces = ctx.state['__plugins'] as Map<string, Record<string, unknown>> | undefined;
    
    if (!namespaces) {
      throw new Error('Plugin context not initialized');
    }
    
    let namespace = namespaces.get(pluginName);
    if (!namespace) {
      namespace = {};
      namespaces.set(pluginName, namespace);
    }
    
    return namespace as T;
  }
  
  /**
   * Set plugin-specific data in request context
   */
  setPluginData(ctx: RequestContext, pluginName: string, data: Record<string, unknown>): void {
    const namespaces = ctx.state['__plugins'] as Map<string, Record<string, unknown>> | undefined;
    
    if (!namespaces) {
      throw new Error('Plugin context not initialized');
    }
    
    namespaces.set(pluginName, data);
  }
  
  /**
   * Update plugin-specific data (merge with existing)
   */
  updatePluginData(ctx: RequestContext, pluginName: string, updates: Record<string, unknown>): void {
    const current = this.getPluginData(ctx, pluginName);
    this.setPluginData(ctx, pluginName, { ...current, ...updates });
  }
  
  /**
   * Set a value in plugin namespace
   */
  set(ctx: RequestContext, pluginName: string, key: string, value: unknown): void {
    const data = this.getPluginData(ctx, pluginName);
    data[key] = value;
  }
  
  /**
   * Get a value from plugin namespace
   */
  get<T = unknown>(ctx: RequestContext, pluginName: string, key: string): T | undefined {
    const data = this.getPluginData(ctx, pluginName);
    return data[key] as T | undefined;
  }
  
  /**
   * Check if a key exists in plugin namespace
   */
  has(ctx: RequestContext, pluginName: string, key: string): boolean {
    const data = this.getPluginData(ctx, pluginName);
    return key in data;
  }
  
  /**
   * Delete a value from plugin namespace
   */
  delete(ctx: RequestContext, pluginName: string, key: string): boolean {
    const data = this.getPluginData(ctx, pluginName);
    return delete data[key];
  }
  
  /**
   * Clear all data for a plugin namespace
   */
  clear(ctx: RequestContext, pluginName: string): void {
    this.setPluginData(ctx, pluginName, {});
  }
  
  /**
   * Get shared metadata (accessible by all plugins)
   * Stored in a special shared namespace
   */
  getSharedMetadata<T = Record<string, unknown>>(ctx: RequestContext): T {
    return this.getPluginData<T>(ctx, '__shared');
  }
  
  /**
   * Set shared metadata
   */
  setSharedMetadata(ctx: RequestContext, data: Record<string, unknown>): void {
    this.setPluginData(ctx, '__shared', data);
  }
  
  /**
   * Set a shared metadata value
   */
  setShared(ctx: RequestContext, key: string, value: unknown): void {
    this.set(ctx, '__shared', key, value);
  }
  
  /**
   * Get a shared metadata value
   */
  getShared<T = unknown>(ctx: RequestContext, key: string): T | undefined {
    return this.get<T>(ctx, '__shared', key);
  }
  
  /**
   * Emit an event on the plugin event bus
   * Allows plugins to communicate with each other
   */
  emit(source: string, eventName: string, payload: unknown): void {
    const event: PluginEvent = {
      name: eventName,
      source,
      payload,
      timestamp: Date.now(),
    };
    
    this.eventBus.emit(eventName, event);
    this.eventBus.emit('*', event); // Wildcard for all events
  }
  
  /**
   * Register an event listener
   */
  on(eventName: string, listener: PluginEventListener): void {
    this.eventBus.on(eventName, listener);
  }
  
  /**
   * Register a one-time event listener
   */
  once(eventName: string, listener: PluginEventListener): void {
    this.eventBus.once(eventName, listener);
  }
  
  /**
   * Remove an event listener
   */
  off(eventName: string, listener: PluginEventListener): void {
    this.eventBus.off(eventName, listener);
  }
  
  /**
   * Remove all event listeners for an event
   */
  removeAllListeners(eventName?: string): void {
    this.eventBus.removeAllListeners(eventName);
  }
  
  /**
   * Get all namespaces for a request
   */
  getAllNamespaces(ctx: RequestContext): string[] {
    const namespaces = ctx.state['__plugins'] as Map<string, Record<string, unknown>> | undefined;
    return namespaces ? Array.from(namespaces.keys()) : [];
  }
  
  /**
   * Clean up context data (called after request completes)
   */
  cleanup(ctx: RequestContext): void {
    const namespaces = ctx.state['__plugins'] as Map<string, Record<string, unknown>> | undefined;
    if (namespaces) {
      namespaces.clear();
    }
  }
}

/**
 * Create plugin context manager instance
 */
export function createPluginContextManager(): PluginContextManager {
  return new PluginContextManager();
}

/**
 * Global plugin context manager instance
 */
export const pluginContextManager = createPluginContextManager();
