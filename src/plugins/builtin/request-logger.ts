/**
 * Request Logger Plugin
 * Structured logging with configurable fields
 */

import { Plugin } from '../../types/plugin.js';
import { RequestContext } from '../../types/core.js';
import { logger } from '../../utils/logger.js';
import { pluginContextManager } from '../context-manager.js';

/**
 * Request logger plugin configuration
 */
export interface RequestLoggerConfig {
  /** Enable request logging (default: true) */
  enabled: boolean;
  /** Log level (default: 'info') */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Include request headers (default: false) */
  includeHeaders: boolean;
  /** Include query parameters (default: true) */
  includeQuery: boolean;
  /** Include route parameters (default: true) */
  includeParams: boolean;
  /** Include response status (default: true) */
  includeStatus: boolean;
  /** Include response headers (default: false) */
  includeResponseHeaders: boolean;
  /** Include user agent (default: true) */
  includeUserAgent: boolean;
  /** Include IP address (default: true) */
  includeIp: boolean;
  /** Headers to redact (e.g., authorization, cookie) */
  redactHeaders: string[];
  /** Log on request start (default: false) */
  logOnStart: boolean;
  /** Log on request completion (default: true) */
  logOnComplete: boolean;
}

/**
 * Request Logger Plugin
 * Provides structured logging of HTTP requests with configurable fields
 */
export class RequestLoggerPlugin implements Plugin {
  name = 'request-logger';
  version = '1.0.0';
  description = 'Structured logging with configurable fields';
  author = 'Gateway Team';
  
  private config: RequestLoggerConfig = {
    enabled: true,
    logLevel: 'info',
    includeHeaders: false,
    includeQuery: true,
    includeParams: true,
    includeStatus: true,
    includeResponseHeaders: false,
    includeUserAgent: true,
    includeIp: true,
    redactHeaders: ['authorization', 'cookie', 'x-api-key'],
    logOnStart: false,
    logOnComplete: true,
  };
  
  init(config: Record<string, unknown>): void {
    if ('enabled' in config && config['enabled'] !== undefined) {
      this.config.enabled = Boolean(config['enabled']);
    }
    if ('logLevel' in config && config['logLevel']) {
      this.config.logLevel = config['logLevel'] as RequestLoggerConfig['logLevel'];
    }
    if ('includeHeaders' in config && config['includeHeaders'] !== undefined) {
      this.config.includeHeaders = Boolean(config['includeHeaders']);
    }
    if ('includeQuery' in config && config['includeQuery'] !== undefined) {
      this.config.includeQuery = Boolean(config['includeQuery']);
    }
    if ('includeParams' in config && config['includeParams'] !== undefined) {
      this.config.includeParams = Boolean(config['includeParams']);
    }
    if ('includeStatus' in config && config['includeStatus'] !== undefined) {
      this.config.includeStatus = Boolean(config['includeStatus']);
    }
    if ('includeResponseHeaders' in config && config['includeResponseHeaders'] !== undefined) {
      this.config.includeResponseHeaders = Boolean(config['includeResponseHeaders']);
    }
    if ('includeUserAgent' in config && config['includeUserAgent'] !== undefined) {
      this.config.includeUserAgent = Boolean(config['includeUserAgent']);
    }
    if ('includeIp' in config && config['includeIp'] !== undefined) {
      this.config.includeIp = Boolean(config['includeIp']);
    }
    if ('redactHeaders' in config && Array.isArray(config['redactHeaders'])) {
      this.config.redactHeaders = config['redactHeaders'].map(String);
    }
    if ('logOnStart' in config && config['logOnStart'] !== undefined) {
      this.config.logOnStart = Boolean(config['logOnStart']);
    }
    if ('logOnComplete' in config && config['logOnComplete'] !== undefined) {
      this.config.logOnComplete = Boolean(config['logOnComplete']);
    }
  }
  
  preRoute(ctx: RequestContext): void {
    if (!this.config.enabled || !this.config.logOnStart) {
      return;
    }
    
    const logData = this.buildLogData(ctx, false);
    logger[this.config.logLevel](logData, 'Request started');
  }
  
  postResponse(ctx: RequestContext): void {
    if (!this.config.enabled || !this.config.logOnComplete) {
      return;
    }
    
    const logData = this.buildLogData(ctx, true);
    logger[this.config.logLevel](logData, 'Request completed');
  }
  
  /**
   * Build log data object
   */
  private buildLogData(ctx: RequestContext, includeResponse: boolean): Record<string, unknown> {
    const data: Record<string, unknown> = {
      requestId: ctx.requestId,
      method: ctx.method,
      path: ctx.path,
    };
    
    // Include query parameters
    if (this.config.includeQuery && ctx.query) {
      data['query'] = ctx.query;
    }
    
    // Include route parameters
    if (this.config.includeParams && Object.keys(ctx.params).length > 0) {
      data['params'] = ctx.params;
    }
    
    // Include request headers
    if (this.config.includeHeaders) {
      data['headers'] = this.redactHeaders(ctx.headers);
    }
    
    // Include user agent
    if (this.config.includeUserAgent) {
      const userAgent = ctx.headers['user-agent'];
      if (userAgent) {
        data['userAgent'] = Array.isArray(userAgent) ? userAgent[0] : userAgent;
      }
    }
    
    // Include IP address
    if (this.config.includeIp) {
      data['ip'] = ctx.req.socket.remoteAddress;
    }
    
    // Include response data if available
    if (includeResponse) {
      if (this.config.includeStatus) {
        data['status'] = ctx.res.statusCode;
      }
      
      if (this.config.includeResponseHeaders) {
        data['responseHeaders'] = ctx.res.getHeaders();
      }
      
      // Include response time if available from response-time plugin
      const responseTime = pluginContextManager.getShared<number>(ctx, 'responseTime');
      if (responseTime !== undefined) {
        data['responseTime'] = responseTime;
      }
    }
    
    return data;
  }
  
  /**
   * Redact sensitive headers
   */
  private redactHeaders(
    headers: Record<string, string | string[] | undefined>
  ): Record<string, string | string[]> {
    const redacted: Record<string, string | string[]> = {};
    
    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) {
        continue;
      }
      
      if (this.config.redactHeaders.includes(key.toLowerCase())) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = value;
      }
    }
    
    return redacted;
  }
}

/**
 * Create request logger plugin instance
 */
export function createRequestLoggerPlugin(
  config?: Partial<RequestLoggerConfig>
): RequestLoggerPlugin {
  const plugin = new RequestLoggerPlugin();
  if (config) {
    plugin.init(config);
  }
  return plugin;
}
