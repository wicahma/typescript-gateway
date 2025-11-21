/**
 * Request ID Plugin
 * Generates and propagates correlation IDs for request tracing
 */

import { Plugin } from '../../types/plugin.js';
import { RequestContext } from '../../types/core.js';
import { randomBytes } from 'crypto';
import { pluginContextManager } from '../context-manager.js';

/**
 * Request ID plugin configuration
 */
export interface RequestIdConfig {
  /** Header name to read/write request ID (default: 'x-request-id') */
  headerName: string;
  /** ID generator function (default: UUID v4) */
  generator: () => string;
  /** Whether to overwrite existing request ID (default: false) */
  overwrite: boolean;
  /** ID prefix (default: 'req-') */
  prefix: string;
}

/**
 * Default request ID generator (UUID-like)
 */
function defaultGenerator(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Request ID Plugin
 * Generates unique request IDs for tracing and correlation
 */
export class RequestIdPlugin implements Plugin {
  name = 'request-id';
  version = '1.0.0';
  description = 'Generates and propagates correlation IDs for request tracing';
  author = 'Gateway Team';
  
  private config: RequestIdConfig = {
    headerName: 'x-request-id',
    generator: defaultGenerator,
    overwrite: false,
    prefix: 'req-',
  };
  
  init(config: Record<string, unknown>): void {
    if ('headerName' in config && config['headerName']) {
      this.config.headerName = String(config['headerName']);
    }
    if ('overwrite' in config && config['overwrite'] !== undefined) {
      this.config.overwrite = Boolean(config['overwrite']);
    }
    if ('prefix' in config && config['prefix']) {
      this.config.prefix = String(config['prefix']);
    }
  }
  
  preRoute(ctx: RequestContext): void {
    // Check if request already has an ID
    const existingId = ctx.headers[this.config.headerName.toLowerCase()];
    
    let requestId: string;
    
    if (existingId && !this.config.overwrite) {
      // Use existing ID
      requestId = Array.isArray(existingId) ? existingId[0] ?? '' : existingId;
    } else {
      // Generate new ID
      requestId = this.config.prefix + this.config.generator();
    }
    
    // Store in context
    ctx.requestId = requestId;
    
    // Store in plugin data for other plugins to access
    pluginContextManager.set(ctx, this.name, 'requestId', requestId);
    pluginContextManager.setShared(ctx, 'requestId', requestId);
    
    // Set response header
    ctx.res.setHeader(this.config.headerName, requestId);
  }
}

/**
 * Create request ID plugin instance
 */
export function createRequestIdPlugin(config?: Partial<RequestIdConfig>): RequestIdPlugin {
  const plugin = new RequestIdPlugin();
  if (config) {
    plugin.init(config);
  }
  return plugin;
}
