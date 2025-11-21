/**
 * Error Response Handler for Phase 7: Resilience & Error Handling
 * 
 * Builds standardized error responses with proper formatting
 * Performance target: < 0.5ms for error response generation
 */

import { GatewayError, getStatusCode } from './errors.js';

/**
 * Standardized error response format
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    statusCode: number;
    timestamp: string;
    requestId?: string;
    retryable?: boolean;
    details?: unknown;
  };
}

/**
 * Error response configuration
 */
export interface ErrorResponseConfig {
  /** Include stack traces in responses */
  includeStackTrace: boolean;
  /** Include internal error details */
  includeDetails: boolean;
  /** Redact PII in error messages */
  redactPII: boolean;
  /** Custom error templates by code */
  templates?: Map<string, string>;
  /** Environment (development, production) */
  environment: 'development' | 'production';
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ErrorResponseConfig = {
  includeStackTrace: process.env['NODE_ENV'] === 'development',
  includeDetails: process.env['NODE_ENV'] === 'development',
  redactPII: process.env['NODE_ENV'] === 'production',
  environment:
    (process.env['NODE_ENV'] as 'development' | 'production') || 'production',
};

/**
 * PII patterns to redact
 */
const PII_PATTERNS = [
  // Email addresses
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  // Phone numbers (US format)
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
  // Credit card numbers
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  // SSN
  /\b\d{3}-\d{2}-\d{4}\b/g,
  // IP addresses
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  // Authorization headers
  /Bearer\s+[A-Za-z0-9-._~+/]+=*/gi,
  /Basic\s+[A-Za-z0-9+/]+=*/gi,
];

/**
 * Error Response Builder
 */
export class ErrorResponseBuilder {
  private config: ErrorResponseConfig;

  constructor(config?: Partial<ErrorResponseConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ErrorResponseConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Build error response from error
   */
  build(
    error: Error | GatewayError,
    requestId?: string
  ): { response: ErrorResponse; statusCode: number; headers: Record<string, string> } {
    const startTime = process.hrtime.bigint();

    let code = 'GATEWAY_ERROR';
    let message = error.message;
    let statusCode = 500;
    let retryable = false;
    let details: unknown = undefined;

    // Extract information from GatewayError
    if (error instanceof GatewayError) {
      code = error.code;
      statusCode = error.statusCode;
      retryable = error.retryable;

      // Apply custom template if available
      const template = this.config.templates?.get(code);
      if (template) {
        message = template;
      }

      // Include details in development
      if (this.config.includeDetails) {
        details = error.toJSON();
      }
    } else {
      statusCode = getStatusCode(error);
    }

    // Redact PII if enabled
    if (this.config.redactPII) {
      message = this.redactPII(message);
    }

    // Build error response
    const response: ErrorResponse = {
      error: {
        code,
        message,
        statusCode,
        timestamp: new Date().toISOString(),
        requestId,
        retryable: this.config.environment === 'development' ? retryable : undefined,
        details: this.config.includeDetails ? details : undefined,
      },
    };

    // Add stack trace in development
    if (this.config.includeStackTrace && error.stack) {
      (response.error as Record<string, unknown>)['stack'] = error.stack;
    }

    // Build response headers
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-error-code': code,
    };

    if (requestId) {
      headers['x-request-id'] = requestId;
    }

    // Add retry-after header for rate limiting errors
    if (statusCode === 429) {
      headers['retry-after'] = '60';
    }

    const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    if (duration > 0.5) {
      // Log if we exceed performance target
      console.warn(
        `Error response generation took ${duration.toFixed(3)}ms (target: < 0.5ms)`
      );
    }

    return { response, statusCode, headers };
  }

  /**
   * Build error response with custom message
   */
  buildCustom(
    code: string,
    message: string,
    statusCode: number,
    requestId?: string,
    retryable?: boolean
  ): { response: ErrorResponse; statusCode: number; headers: Record<string, string> } {
    // Redact PII if enabled
    const finalMessage = this.config.redactPII ? this.redactPII(message) : message;

    const response: ErrorResponse = {
      error: {
        code,
        message: finalMessage,
        statusCode,
        timestamp: new Date().toISOString(),
        requestId,
        retryable: this.config.environment === 'development' ? retryable : undefined,
      },
    };

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-error-code': code,
    };

    if (requestId) {
      headers['x-request-id'] = requestId;
    }

    return { response, statusCode, headers };
  }

  /**
   * Set custom error template
   */
  setTemplate(code: string, template: string): void {
    if (!this.config.templates) {
      this.config.templates = new Map();
    }
    this.config.templates.set(code, template);
  }

  /**
   * Remove custom error template
   */
  removeTemplate(code: string): void {
    this.config.templates?.delete(code);
  }

  /**
   * Redact PII from message
   */
  private redactPII(message: string): string {
    let redacted = message;

    for (const pattern of PII_PATTERNS) {
      redacted = redacted.replace(pattern, '[REDACTED]');
    }

    return redacted;
  }

  /**
   * Map status code to error code
   */
  static statusCodeToErrorCode(statusCode: number): string {
    const codeMap: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      405: 'METHOD_NOT_ALLOWED',
      408: 'REQUEST_TIMEOUT',
      409: 'CONFLICT',
      413: 'PAYLOAD_TOO_LARGE',
      415: 'UNSUPPORTED_MEDIA_TYPE',
      429: 'RATE_LIMIT_EXCEEDED',
      500: 'INTERNAL_SERVER_ERROR',
      501: 'NOT_IMPLEMENTED',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
      504: 'GATEWAY_TIMEOUT',
    };

    return codeMap[statusCode] || 'GATEWAY_ERROR';
  }

  /**
   * Format error response as JSON string
   */
  toJSON(response: ErrorResponse): string {
    return JSON.stringify(response);
  }

  /**
   * Format error response as Buffer
   */
  toBuffer(response: ErrorResponse): Buffer {
    return Buffer.from(this.toJSON(response), 'utf-8');
  }
}

/**
 * Global error response builder instance
 */
export const errorResponseBuilder = new ErrorResponseBuilder();
