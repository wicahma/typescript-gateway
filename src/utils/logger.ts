import { hostname } from 'os';
import { appendFileSync } from 'fs';

export enum LogLevel {
  TRACE = 'trace',
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  [LogLevel.TRACE]: 10,
  [LogLevel.DEBUG]: 20,
  [LogLevel.INFO]: 30,
  [LogLevel.WARN]: 40,
  [LogLevel.ERROR]: 50,
  [LogLevel.FATAL]: 60,
};

export interface LoggerConfig {
  level: LogLevel;
  pretty?: boolean;
  destination?: string;
  slowRequestThreshold?: number;
  errorSampling?: number;
  componentLevels?: Record<string, LogLevel>;
  enableCorrelationId?: boolean;
}

export interface LogContext {
  correlationId?: string;
  component?: string;
  route?: string;
  upstream?: string;
  userId?: string;
  [key: string]: unknown;
}

export interface Logger {
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  fatal(obj: unknown, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

class FastNativeLogger implements Logger {
  private level: LogLevel;
  private levelWeight: number;
  private bindings: Record<string, unknown>;
  private destination?: string;
  private pid: number;
  private host: string;

  constructor(
    level: LogLevel = LogLevel.INFO,
    bindings: Record<string, unknown> = {},
    destination?: string
  ) {
    this.level = level;
    this.levelWeight = LEVEL_WEIGHT[level] ?? 30;
    this.bindings = bindings;
    this.destination = destination;
    this.pid = process.pid;
    this.host = hostname();
  }

  child(bindings: Record<string, unknown>): Logger {
    const childLevel = (bindings['level'] as LogLevel) || this.level;
    return new FastNativeLogger(
      childLevel,
      { ...this.bindings, ...bindings },
      this.destination
    );
  }

  private write(level: LogLevel, obj: unknown, msg?: string): void {
    if ((LEVEL_WEIGHT[level] ?? 30) < this.levelWeight) return;

    let payload: Record<string, unknown>;
    if (typeof obj === 'string') {
      payload = { level, time: new Date().toISOString(), pid: this.pid, hostname: this.host, ...this.bindings, msg: obj };
    } else if (obj && typeof obj === 'object') {
      payload = { level, time: new Date().toISOString(), pid: this.pid, hostname: this.host, ...this.bindings, ...(obj as Record<string, unknown>) };
      if (msg) payload['msg'] = msg;
    } else {
      payload = { level, time: new Date().toISOString(), pid: this.pid, hostname: this.host, ...this.bindings, data: obj };
      if (msg) payload['msg'] = msg;
    }

    const line = JSON.stringify(payload) + '\n';
    if (this.destination) {
      try {
        appendFileSync(this.destination, line);
      } catch {
        process.stdout.write(line);
      }
    } else {
      process.stdout.write(line);
    }
  }

  trace(obj: unknown, msg?: string): void { this.write(LogLevel.TRACE, obj, msg); }
  debug(obj: unknown, msg?: string): void { this.write(LogLevel.DEBUG, obj, msg); }
  info(obj: unknown, msg?: string): void { this.write(LogLevel.INFO, obj, msg); }
  warn(obj: unknown, msg?: string): void { this.write(LogLevel.WARN, obj, msg); }
  error(obj: unknown, msg?: string): void { this.write(LogLevel.ERROR, obj, msg); }
  fatal(obj: unknown, msg?: string): void { this.write(LogLevel.FATAL, obj, msg); }
}

export function createLogger(config: Partial<LoggerConfig> = {}): Logger {
  const level = config.level || ((process.env['LOG_LEVEL'] as LogLevel) || LogLevel.INFO);
  return new FastNativeLogger(level, {}, config.destination);
}

export const logger = createLogger({
  level: (process.env['LOG_LEVEL'] as LogLevel) || LogLevel.INFO,
});

export class StructuredLogger {
  private baseLogger: Logger;
  private config: LoggerConfig;
  private componentLoggers = new Map<string, Logger>();

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: LogLevel.INFO,
      slowRequestThreshold: 100,
      errorSampling: 1.0,
      componentLevels: {},
      enableCorrelationId: true,
      ...config,
    };
    this.baseLogger = createLogger(this.config);
  }

  component(componentName: string): Logger {
    let cl = this.componentLoggers.get(componentName);
    if (!cl) {
      const level = this.config.componentLevels?.[componentName] || this.config.level;
      cl = this.baseLogger.child({ component: componentName, level });
      this.componentLoggers.set(componentName, cl);
    }
    return cl;
  }

  withCorrelation(correlationId: string): Logger {
    return this.baseLogger.child({ correlationId });
  }

  withContext(context: LogContext): Logger {
    return this.baseLogger.child(context);
  }

  logSlowRequest(method: string, path: string, latencyMs: number, context?: LogContext): void {
    const threshold = this.config.slowRequestThreshold || 100;
    if (latencyMs > threshold) {
      this.baseLogger.warn({ ...context, method, path, latencyMs: Number(latencyMs.toFixed(2)), threshold }, 'Slow request detected');
    }
  }

  logError(error: Error, context?: LogContext): void {
    const rate = this.config.errorSampling ?? 1.0;
    if (Math.random() > rate) return;
    this.baseLogger.error({ ...context, err: { name: error.name, message: error.message, stack: error.stack } }, 'Error occurred');
  }

  logRequest(method: string, path: string, requestId: string, context?: LogContext): void {
    this.baseLogger.info({ ...context, method, path, requestId }, 'Incoming request');
  }

  logResponse(method: string, path: string, statusCode: number, latencyMs: number, requestId: string, context?: LogContext): void {
    const fn = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    this.baseLogger[fn]({ ...context, method, path, statusCode, latencyMs: Number(latencyMs.toFixed(2)), requestId }, 'Request completed');
  }

  updateConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
    this.baseLogger = createLogger(this.config);
    this.componentLoggers.clear();
  }

  getLogger(): Logger {
    return this.baseLogger;
  }
}

export function createRequestLogger() {
  return {
    logRequest(method: string, path: string, requestId: string) {
      logger.info({ method, path, requestId }, 'Incoming request');
    },
    logResponse(method: string, path: string, statusCode: number, latencyMs: number, requestId: string) {
      const fn = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
      logger[fn]({ method, path, statusCode, latencyMs: Number(latencyMs.toFixed(2)), requestId }, 'Request completed');
    },
    logError(error: Error, method: string, path: string, requestId: string) {
      logger.error({ err: error, method, path, requestId }, 'Request error');
    },
  };
}

export function logSlowRequest(method: string, path: string, latencyMs: number, threshold: number = 100): void {
  if (latencyMs > threshold) {
    logger.warn({ method, path, latencyMs: Number(latencyMs.toFixed(2)), threshold }, 'Slow request detected');
  }
}
