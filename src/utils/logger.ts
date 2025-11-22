/**
 * Minimal structured logger using Pino
 * High-performance async logging
 * Phase 8: Enhanced with structured logging features
 */

import pino from 'pino';
import { hostname } from 'os';

/**
 * Log levels
 */
export enum LogLevel {
  TRACE = 'trace',
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  level: LogLevel;
  pretty: boolean;
  destination?: string;
  /** Slow request threshold in milliseconds (Phase 8) */
  slowRequestThreshold?: number;
  /** Error sampling rate 0.0-1.0 (Phase 8) */
  errorSampling?: number;
  /** Component-specific log levels (Phase 8) */
  componentLevels?: Record<string, LogLevel>;
  /** Enable correlation ID tracking (Phase 8) */
  enableCorrelationId?: boolean;
}

/**
 * Log context for structured logging (Phase 8)
 */
export interface LogContext {
  /** Request/correlation ID */
  correlationId?: string;
  /** Component name */
  component?: string;
  /** Route pattern */
  route?: string;
  /** Upstream ID */
  upstream?: string;
  /** User ID or session */
  userId?: string;
  /** Additional context */
  [key: string]: unknown;
}

/**
 * Create logger instance with configuration
 */
export function createLogger(config: Partial<LoggerConfig> = {}): pino.Logger {
  const {
    level = LogLevel.INFO,
    pretty = process.env['NODE_ENV'] !== 'production',
    destination,
  } = config;

  const options: pino.LoggerOptions = {
    level,
    // Performance optimizations
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: label => ({ level: label }),
    },
    serializers: {
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
      err: pino.stdSerializers.err,
    },
    // Phase 8: Base context for all logs
    base: {
      pid: process.pid,
      hostname: hostname(),
    },
  };

  // Pretty print for development (skip if pino-pretty not available)
  if (pretty) {
    try {
      return pino({
        ...options,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      });
    } catch {
      // pino-pretty not available (e.g., in tests), fall back to standard output
      return pino(options);
    }
  }

  // Fast JSON output for production
  if (destination) {
    return pino(options, pino.destination(destination));
  }

  return pino(options);
}

/**
 * Default logger instance
 */
export const logger = createLogger({
  level: (process.env['LOG_LEVEL'] as LogLevel) || LogLevel.INFO,
  pretty: process.env['NODE_ENV'] !== 'production',
});

/**
 * Enhanced structured logger (Phase 8)
 */
export class StructuredLogger {
  private logger: pino.Logger;
  private config: LoggerConfig;
  private componentLoggers: Map<string, pino.Logger> = new Map();

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: LogLevel.INFO,
      pretty: process.env['NODE_ENV'] !== 'production',
      slowRequestThreshold: 100,
      errorSampling: 1.0,
      componentLevels: {},
      enableCorrelationId: true,
      ...config,
    };

    this.logger = createLogger(this.config);
  }

  /**
   * Get component-specific logger
   */
  component(componentName: string): pino.Logger {
    let componentLogger = this.componentLoggers.get(componentName);
    
    if (!componentLogger) {
      const componentLevel = this.config.componentLevels?.[componentName] || this.config.level;
      componentLogger = this.logger.child({
        component: componentName,
        level: componentLevel,
      });
      this.componentLoggers.set(componentName, componentLogger);
    }

    return componentLogger;
  }

  /**
   * Log with correlation ID
   */
  withCorrelation(correlationId: string): pino.Logger {
    return this.logger.child({ correlationId });
  }

  /**
   * Log with full context
   */
  withContext(context: LogContext): pino.Logger {
    return this.logger.child(context);
  }

  /**
   * Log slow request (performance-based sampling)
   */
  logSlowRequest(
    method: string,
    path: string,
    latencyMs: number,
    context?: LogContext
  ): void {
    const threshold = this.config.slowRequestThreshold || 100;
    
    if (latencyMs > threshold) {
      const logContext = {
        ...context,
        method,
        path,
        latencyMs: latencyMs.toFixed(2),
        threshold,
      };

      this.logger.warn(logContext, 'Slow request detected');
    }
  }

  /**
   * Log error with sampling
   */
  logError(error: Error, context?: LogContext): void {
    const samplingRate = this.config.errorSampling || 1.0;
    
    // Sample errors based on rate
    if (Math.random() > samplingRate) {
      return;
    }

    const logContext = {
      ...context,
      err: error,
      errorType: error.name,
      errorMessage: error.message,
    };

    this.logger.error(logContext, 'Error occurred');
  }

  /**
   * Log with automatic context enrichment
   */
  logRequest(
    method: string,
    path: string,
    requestId: string,
    additionalContext?: LogContext
  ): void {
    const context = {
      ...additionalContext,
      method,
      path,
      requestId,
    };

    this.logger.info(context, 'Incoming request');
  }

  /**
   * Log response with automatic status-based level
   */
  logResponse(
    method: string,
    path: string,
    statusCode: number,
    latencyMs: number,
    requestId: string,
    additionalContext?: LogContext
  ): void {
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    
    const context = {
      ...additionalContext,
      method,
      path,
      statusCode,
      latencyMs: latencyMs.toFixed(2),
      requestId,
    };

    this.logger[level](context, 'Request completed');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Recreate logger with new config
    this.logger = createLogger(this.config);
    
    // Clear component loggers cache
    this.componentLoggers.clear();
  }

  /**
   * Get underlying Pino logger
   */
  getLogger(): pino.Logger {
    return this.logger;
  }
}

/**
 * Request logger middleware
 * Logs request/response with minimal overhead
 */
export function createRequestLogger() {
  return {
    logRequest(method: string, path: string, requestId: string) {
      logger.info({ method, path, requestId }, 'Incoming request');
    },

    logResponse(
      method: string,
      path: string,
      statusCode: number,
      latencyMs: number,
      requestId: string
    ) {
      const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
      logger[level](
        {
          method,
          path,
          statusCode,
          latencyMs: latencyMs.toFixed(2),
          requestId,
        },
        'Request completed'
      );
    },

    logError(error: Error, method: string, path: string, requestId: string) {
      logger.error(
        {
          err: error,
          method,
          path,
          requestId,
        },
        'Request error'
      );
    },
  };
}

/**
 * Performance logger for slow requests
 */
export function logSlowRequest(
  method: string,
  path: string,
  latencyMs: number,
  threshold: number = 100
): void {
  if (latencyMs > threshold) {
    logger.warn(
      {
        method,
        path,
        latencyMs: latencyMs.toFixed(2),
        threshold,
      },
      'Slow request detected'
    );
  }
}
