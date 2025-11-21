/**
 * Minimal structured logger using Pino
 * High-performance async logging
 */

import pino from 'pino';

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
