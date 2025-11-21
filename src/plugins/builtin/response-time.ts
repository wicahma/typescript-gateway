/**
 * Response Time Plugin
 * Tracks and reports response times in headers and logs
 */

import { Plugin } from '../../types/plugin.js';
import { RequestContext } from '../../types/core.js';
import { pluginContextManager } from '../context-manager.js';
import { logger } from '../../utils/logger.js';

/**
 * Response time plugin configuration
 */
export interface ResponseTimeConfig {
  /** Header name to add response time (default: 'x-response-time') */
  headerName: string;
  /** Enable logging of response time (default: true) */
  enableLogging: boolean;
  /** Log level for response time (default: 'debug') */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Warn threshold in milliseconds (log warning if exceeded) */
  warnThreshold: number;
  /** Unit for header value (default: 'ms') */
  unit: 'ms' | 'us' | 's';
  /** Number of decimal places (default: 2) */
  decimals: number;
}

/**
 * Response Time Plugin
 * Tracks request processing time and adds header with duration
 */
export class ResponseTimePlugin implements Plugin {
  name = 'response-time';
  version = '1.0.0';
  description = 'Tracks and reports response times in headers and logs';
  author = 'Gateway Team';
  
  private config: ResponseTimeConfig = {
    headerName: 'x-response-time',
    enableLogging: true,
    logLevel: 'debug',
    warnThreshold: 1000, // 1 second
    unit: 'ms',
    decimals: 2,
  };
  
  init(config: Record<string, unknown>): void {
    if ('headerName' in config && config['headerName']) {
      this.config.headerName = String(config['headerName']);
    }
    if ('enableLogging' in config && config['enableLogging'] !== undefined) {
      this.config.enableLogging = Boolean(config['enableLogging']);
    }
    if ('logLevel' in config && config['logLevel']) {
      this.config.logLevel = config['logLevel'] as ResponseTimeConfig['logLevel'];
    }
    if ('warnThreshold' in config && typeof config['warnThreshold'] === 'number') {
      this.config.warnThreshold = config['warnThreshold'];
    }
    if ('unit' in config && config['unit']) {
      this.config.unit = config['unit'] as ResponseTimeConfig['unit'];
    }
    if ('decimals' in config && typeof config['decimals'] === 'number') {
      this.config.decimals = config['decimals'];
    }
  }
  
  preRoute(ctx: RequestContext): void {
    // Record start time in high-resolution
    const startTime = process.hrtime.bigint();
    pluginContextManager.set(ctx, this.name, 'startTime', startTime);
  }
  
  postHandler(ctx: RequestContext): void {
    const startTime = pluginContextManager.get<bigint>(ctx, this.name, 'startTime');
    
    if (!startTime) {
      return;
    }
    
    const endTime = process.hrtime.bigint();
    const durationNanos = Number(endTime - startTime);
    
    // Convert to desired unit
    let duration: number;
    let unitStr: string;
    
    switch (this.config.unit) {
      case 'us':
        duration = durationNanos / 1000;
        unitStr = 'μs';
        break;
      case 's':
        duration = durationNanos / 1_000_000_000;
        unitStr = 's';
        break;
      case 'ms':
      default:
        duration = durationNanos / 1_000_000;
        unitStr = 'ms';
        break;
    }
    
    // Format with specified decimal places
    const formattedDuration = duration.toFixed(this.config.decimals);
    
    // Store in plugin data
    pluginContextManager.set(ctx, this.name, 'duration', duration);
    pluginContextManager.set(ctx, this.name, 'durationFormatted', formattedDuration);
    pluginContextManager.setShared(ctx, 'responseTime', duration);
    
    // Add header
    ctx.res.setHeader(this.config.headerName, `${formattedDuration}${unitStr}`);
    
    // Log if enabled
    if (this.config.enableLogging) {
      const logData = {
        requestId: ctx.requestId,
        method: ctx.method,
        path: ctx.path,
        duration: formattedDuration,
        unit: unitStr,
      };
      
      // Warn if threshold exceeded
      const durationMs = this.config.unit === 'ms' ? duration : durationNanos / 1_000_000;
      
      if (durationMs > this.config.warnThreshold) {
        logger.warn(logData, `Slow request: ${formattedDuration}${unitStr}`);
      } else {
        logger[this.config.logLevel](logData, `Request completed in ${formattedDuration}${unitStr}`);
      }
    }
  }
}

/**
 * Create response time plugin instance
 */
export function createResponseTimePlugin(config?: Partial<ResponseTimeConfig>): ResponseTimePlugin {
  const plugin = new ResponseTimePlugin();
  if (config) {
    plugin.init(config);
  }
  return plugin;
}
