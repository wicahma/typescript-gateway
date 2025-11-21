/**
 * Error class hierarchy for Phase 7: Resilience & Error Handling
 * 
 * Provides typed error classes with context for better error handling
 * Performance target: < 0.05ms overhead
 */

/**
 * Error context information
 */
export interface ErrorContext {
  /** Error code (machine-readable) */
  code: string;
  /** User message (human-readable) */
  message: string;
  /** Timestamp of error occurrence */
  timestamp: number;
  /** Request context (route, upstream, etc.) */
  requestContext?: {
    requestId?: string;
    route?: string;
    upstream?: string;
    method?: string;
    path?: string;
  };
  /** Whether this error is retryable */
  retryable: boolean;
  /** Original error if this wraps another error */
  originalError?: Error;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Base gateway error class
 */
export class GatewayError extends Error {
  public readonly code: string;
  public readonly timestamp: number;
  public readonly retryable: boolean;
  public readonly requestContext?: ErrorContext['requestContext'];
  public readonly originalError?: Error;
  public readonly metadata?: Record<string, unknown>;
  public readonly statusCode: number;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    retryable: boolean = false,
    options?: {
      requestContext?: ErrorContext['requestContext'];
      originalError?: Error;
      metadata?: Record<string, unknown>;
    }
  ) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.statusCode = statusCode;
    this.timestamp = Date.now();
    this.retryable = retryable;
    this.requestContext = options?.requestContext;
    this.originalError = options?.originalError;
    this.metadata = options?.metadata;

    // Maintain proper stack trace for where error was thrown (V8 optimization)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON for serialization
   */
  toJSON(): ErrorContext & { statusCode: number; stack?: string } {
    return {
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      requestContext: this.requestContext,
      retryable: this.retryable,
      metadata: this.metadata,
      statusCode: this.statusCode,
      stack: process.env['NODE_ENV'] === 'development' ? this.stack : undefined,
    };
  }

  /**
   * Get error context
   */
  getContext(): ErrorContext {
    return {
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      requestContext: this.requestContext,
      retryable: this.retryable,
      originalError: this.originalError,
      metadata: this.metadata,
    };
  }
}

/**
 * Upstream-related error
 */
export class UpstreamError extends GatewayError {
  constructor(
    message: string,
    code: string = 'UPSTREAM_ERROR',
    statusCode: number = 502,
    retryable: boolean = true,
    options?: {
      requestContext?: ErrorContext['requestContext'];
      originalError?: Error;
      metadata?: Record<string, unknown>;
    }
  ) {
    super(message, code, statusCode, retryable, options);
    this.name = 'UpstreamError';
  }
}

/**
 * Timeout-specific error
 */
export class TimeoutError extends GatewayError {
  public readonly timeoutType: 'connection' | 'request' | 'upstream' | 'plugin';
  public readonly timeoutMs: number;

  constructor(
    message: string,
    timeoutType: 'connection' | 'request' | 'upstream' | 'plugin',
    timeoutMs: number,
    code: string = 'TIMEOUT_ERROR',
    statusCode: number = 504,
    retryable: boolean = true,
    options?: {
      requestContext?: ErrorContext['requestContext'];
      originalError?: Error;
      metadata?: Record<string, unknown>;
    }
  ) {
    super(message, code, statusCode, retryable, options);
    this.name = 'TimeoutError';
    this.timeoutType = timeoutType;
    this.timeoutMs = timeoutMs;
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      timeoutType: this.timeoutType,
      timeoutMs: this.timeoutMs,
    };
  }
}

/**
 * Validation error (request/config validation)
 */
export class ValidationError extends GatewayError {
  public readonly validationErrors: Array<{ field: string; message: string }>;

  constructor(
    message: string,
    validationErrors: Array<{ field: string; message: string }>,
    code: string = 'VALIDATION_ERROR',
    statusCode: number = 400,
    retryable: boolean = false,
    options?: {
      requestContext?: ErrorContext['requestContext'];
      originalError?: Error;
      metadata?: Record<string, unknown>;
    }
  ) {
    super(message, code, statusCode, retryable, options);
    this.name = 'ValidationError';
    this.validationErrors = validationErrors;
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      validationErrors: this.validationErrors,
    };
  }
}

/**
 * Plugin execution error
 */
export class PluginError extends GatewayError {
  public readonly pluginName: string;
  public readonly hook: string;

  constructor(
    message: string,
    pluginName: string,
    hook: string,
    code: string = 'PLUGIN_ERROR',
    statusCode: number = 500,
    retryable: boolean = false,
    options?: {
      requestContext?: ErrorContext['requestContext'];
      originalError?: Error;
      metadata?: Record<string, unknown>;
    }
  ) {
    super(message, code, statusCode, retryable, options);
    this.name = 'PluginError';
    this.pluginName = pluginName;
    this.hook = hook;
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      pluginName: this.pluginName,
      hook: this.hook,
    };
  }
}

/**
 * Circuit breaker error (circuit open)
 */
export class CircuitBreakerError extends GatewayError {
  public readonly upstreamId: string;
  public readonly circuitState: string;

  constructor(
    message: string,
    upstreamId: string,
    circuitState: string,
    code: string = 'CIRCUIT_BREAKER_OPEN',
    statusCode: number = 503,
    retryable: boolean = false,
    options?: {
      requestContext?: ErrorContext['requestContext'];
      originalError?: Error;
      metadata?: Record<string, unknown>;
    }
  ) {
    super(message, code, statusCode, retryable, options);
    this.name = 'CircuitBreakerError';
    this.upstreamId = upstreamId;
    this.circuitState = circuitState;
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      upstreamId: this.upstreamId,
      circuitState: this.circuitState,
    };
  }
}

/**
 * Connection pool error
 */
export class ConnectionError extends GatewayError {
  public readonly poolId: string;

  constructor(
    message: string,
    poolId: string,
    code: string = 'CONNECTION_ERROR',
    statusCode: number = 503,
    retryable: boolean = true,
    options?: {
      requestContext?: ErrorContext['requestContext'];
      originalError?: Error;
      metadata?: Record<string, unknown>;
    }
  ) {
    super(message, code, statusCode, retryable, options);
    this.name = 'ConnectionError';
    this.poolId = poolId;
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      poolId: this.poolId,
    };
  }
}

/**
 * Helper to check if error is retryable
 */
export function isRetryable(error: Error | GatewayError): boolean {
  if (error instanceof GatewayError) {
    return error.retryable;
  }
  
  // Default retryability for non-GatewayError errors
  // Network errors and timeouts are typically retryable
  const message = error.message.toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('ehostunreach') ||
    message.includes('enetunreach')
  );
}

/**
 * Helper to determine HTTP status code from error
 */
export function getStatusCode(error: Error | GatewayError): number {
  if (error instanceof GatewayError) {
    return error.statusCode;
  }

  // Default status codes for common error types
  const message = error.message.toLowerCase();
  if (message.includes('timeout')) {
    return 504;
  } else if (message.includes('not found')) {
    return 404;
  } else if (message.includes('unauthorized') || message.includes('forbidden')) {
    return 403;
  } else if (message.includes('bad request') || message.includes('invalid')) {
    return 400;
  } else if (message.includes('unavailable') || message.includes('econnrefused')) {
    return 503;
  }

  return 500;
}

/**
 * Helper to wrap standard errors in GatewayError
 */
export function wrapError(
  error: Error,
  requestContext?: ErrorContext['requestContext']
): GatewayError {
  if (error instanceof GatewayError) {
    return error;
  }

  const message = error.message.toLowerCase();
  const retryable = isRetryable(error);
  const statusCode = getStatusCode(error);

  if (message.includes('timeout')) {
    return new TimeoutError(
      error.message,
      'request',
      0,
      'TIMEOUT_ERROR',
      statusCode,
      retryable,
      { requestContext, originalError: error }
    );
  } else if (message.includes('circuit') || message.includes('breaker')) {
    return new CircuitBreakerError(
      error.message,
      requestContext?.upstream || 'unknown',
      'OPEN',
      'CIRCUIT_BREAKER_OPEN',
      503, // Circuit breaker errors are always 503
      retryable,
      { requestContext, originalError: error }
    );
  } else if (
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('connection')
  ) {
    return new ConnectionError(
      error.message,
      requestContext?.upstream || 'unknown',
      'CONNECTION_ERROR',
      statusCode,
      retryable,
      { requestContext, originalError: error }
    );
  } else if (message.includes('upstream') || message.includes('backend')) {
    return new UpstreamError(
      error.message,
      'UPSTREAM_ERROR',
      statusCode,
      retryable,
      { requestContext, originalError: error }
    );
  }

  return new GatewayError(error.message, 'GATEWAY_ERROR', statusCode, retryable, {
    requestContext,
    originalError: error,
  });
}
