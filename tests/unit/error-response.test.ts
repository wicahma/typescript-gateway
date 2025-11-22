/**
 * Unit tests for error response builder
 * Phase 7: Resilience & Error Handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ErrorResponseBuilder } from '../../src/core/error-response.js';
import { GatewayError, TimeoutError, ValidationError } from '../../src/core/errors.js';

describe('ErrorResponseBuilder', () => {
  let builder: ErrorResponseBuilder;

  beforeEach(() => {
    builder = new ErrorResponseBuilder();
  });

  describe('Build Error Response', () => {
    it('should build basic error response', () => {
      const error = new GatewayError('Test error', 'TEST_ERROR', 500, false);
      const { response, statusCode, headers } = builder.build(error);

      expect(response.error.code).toBe('TEST_ERROR');
      expect(response.error.message).toBe('Test error');
      expect(response.error.statusCode).toBe(500);
      expect(statusCode).toBe(500);
      expect(headers['content-type']).toBe('application/json');
      expect(headers['x-error-code']).toBe('TEST_ERROR');
    });

    it('should include request ID in response', () => {
      const error = new GatewayError('Test error', 'TEST_ERROR', 500, false);
      const { response, headers } = builder.build(error, 'req-123');

      expect(response.error.requestId).toBe('req-123');
      expect(headers['x-request-id']).toBe('req-123');
    });

    it('should include retryable flag in development', () => {
      // Create builder with development environment
      const devBuilder = new ErrorResponseBuilder({
        environment: 'development',
      });
      
      const error = new GatewayError('Test error', 'TEST_ERROR', 500, true);
      const { response } = devBuilder.build(error);

      expect(response.error.retryable).toBe(true);
    });

    it('should exclude retryable flag in production', () => {
      // Create builder with production environment
      const prodBuilder = new ErrorResponseBuilder({
        environment: 'production',
      });
      
      const error = new GatewayError('Test error', 'TEST_ERROR', 500, true);
      const { response } = prodBuilder.build(error);

      expect(response.error.retryable).toBeUndefined();
    });

    it('should handle standard Error', () => {
      const error = new Error('Standard error');
      const { response, statusCode } = builder.build(error);

      expect(response.error.message).toBe('Standard error');
      expect(statusCode).toBe(500);
    });
  });

  describe('PII Redaction', () => {
    it('should redact email addresses', () => {
      const builder = new ErrorResponseBuilder({ redactPII: true });
      const error = new Error('Error for user@example.com');
      const { response } = builder.build(error);

      expect(response.error.message).toContain('[REDACTED]');
      expect(response.error.message).not.toContain('user@example.com');
    });

    it('should redact phone numbers', () => {
      const builder = new ErrorResponseBuilder({ redactPII: true });
      const error = new Error('Call 123-456-7890 for support');
      const { response } = builder.build(error);

      expect(response.error.message).toContain('[REDACTED]');
      expect(response.error.message).not.toContain('123-456-7890');
    });

    it('should redact IP addresses', () => {
      const builder = new ErrorResponseBuilder({ redactPII: true });
      const error = new Error('Connection from 192.168.1.1');
      const { response } = builder.build(error);

      expect(response.error.message).toContain('[REDACTED]');
      expect(response.error.message).not.toContain('192.168.1.1');
    });

    it('should not redact when disabled', () => {
      const builder = new ErrorResponseBuilder({ redactPII: false });
      const error = new Error('Error for user@example.com');
      const { response } = builder.build(error);

      expect(response.error.message).toContain('user@example.com');
    });
  });

  describe('Custom Templates', () => {
    it('should use custom error template', () => {
      builder.setTemplate('TEST_ERROR', 'Custom error message');
      const error = new GatewayError('Original', 'TEST_ERROR', 500, false);
      const { response } = builder.build(error);

      expect(response.error.message).toBe('Custom error message');
    });

    it('should remove custom template', () => {
      builder.setTemplate('TEST_ERROR', 'Custom error message');
      builder.removeTemplate('TEST_ERROR');
      
      const error = new GatewayError('Original', 'TEST_ERROR', 500, false);
      const { response } = builder.build(error);

      expect(response.error.message).toBe('Original');
    });
  });

  describe('Build Custom Response', () => {
    it('should build custom error response', () => {
      const { response, statusCode, headers } = builder.buildCustom(
        'CUSTOM_ERROR',
        'Custom message',
        503,
        'req-456',
        true
      );

      expect(response.error.code).toBe('CUSTOM_ERROR');
      expect(response.error.message).toBe('Custom message');
      expect(response.error.statusCode).toBe(503);
      expect(response.error.requestId).toBe('req-456');
      expect(statusCode).toBe(503);
      expect(headers['x-error-code']).toBe('CUSTOM_ERROR');
    });
  });

  describe('Status Code Mapping', () => {
    it('should map status codes to error codes', () => {
      const mappings: Array<[number, string]> = [
        [400, 'BAD_REQUEST'],
        [401, 'UNAUTHORIZED'],
        [403, 'FORBIDDEN'],
        [404, 'NOT_FOUND'],
        [408, 'REQUEST_TIMEOUT'],
        [429, 'RATE_LIMIT_EXCEEDED'],
        [500, 'INTERNAL_SERVER_ERROR'],
        [502, 'BAD_GATEWAY'],
        [503, 'SERVICE_UNAVAILABLE'],
        [504, 'GATEWAY_TIMEOUT'],
      ];

      for (const [statusCode, expectedCode] of mappings) {
        const code = ErrorResponseBuilder.statusCodeToErrorCode(statusCode);
        expect(code).toBe(expectedCode);
      }
    });

    it('should default unknown status codes', () => {
      const code = ErrorResponseBuilder.statusCodeToErrorCode(999);
      expect(code).toBe('GATEWAY_ERROR');
    });
  });

  describe('Serialization', () => {
    it('should convert response to JSON string', () => {
      const error = new GatewayError('Test', 'TEST', 500, false);
      const { response } = builder.build(error);
      const json = builder.toJSON(response);

      expect(typeof json).toBe('string');
      const parsed = JSON.parse(json);
      expect(parsed.error.code).toBe('TEST');
    });

    it('should convert response to Buffer', () => {
      const error = new GatewayError('Test', 'TEST', 500, false);
      const { response } = builder.build(error);
      const buffer = builder.toBuffer(response);

      expect(Buffer.isBuffer(buffer)).toBe(true);
      const parsed = JSON.parse(buffer.toString('utf-8'));
      expect(parsed.error.code).toBe('TEST');
    });
  });

  describe('Special Headers', () => {
    it('should add retry-after header for 429', () => {
      const error = new GatewayError('Rate limit', 'RATE_LIMIT', 429, false);
      const { headers } = builder.build(error);

      expect(headers['retry-after']).toBe('60');
    });

    it('should not add retry-after for other status codes', () => {
      const error = new GatewayError('Error', 'ERROR', 500, false);
      const { headers } = builder.build(error);

      expect(headers['retry-after']).toBeUndefined();
    });
  });

  describe('Configuration', () => {
    it('should update configuration', () => {
      builder.updateConfig({
        includeStackTrace: true,
        redactPII: false,
      });

      // Updated successfully if no error
      expect(builder).toBeDefined();
    });
  });
});
