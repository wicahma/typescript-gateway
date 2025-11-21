/**
 * Unit tests for error class hierarchy
 * Phase 7: Resilience & Error Handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  GatewayError,
  UpstreamError,
  TimeoutError,
  ValidationError,
  PluginError,
  CircuitBreakerError,
  ConnectionError,
  isRetryable,
  getStatusCode,
  wrapError,
} from '../../src/core/errors.js';

describe('Error Classes', () => {
  describe('GatewayError', () => {
    it('should create a basic gateway error', () => {
      const error = new GatewayError('Test error', 'TEST_ERROR', 500, false);
      
      expect(error.name).toBe('GatewayError');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.retryable).toBe(false);
      expect(error.timestamp).toBeDefined();
    });

    it('should include request context', () => {
      const requestContext = {
        requestId: 'req-123',
        route: '/api/test',
        upstream: 'backend',
        method: 'GET',
        path: '/api/test',
      };

      const error = new GatewayError('Test error', 'TEST_ERROR', 500, false, {
        requestContext,
      });

      expect(error.requestContext).toEqual(requestContext);
    });

    it('should wrap original error', () => {
      const original = new Error('Original error');
      const error = new GatewayError('Wrapped error', 'WRAPPED_ERROR', 500, false, {
        originalError: original,
      });

      expect(error.originalError).toBe(original);
    });

    it('should serialize to JSON', () => {
      const error = new GatewayError('Test error', 'TEST_ERROR', 500, false);
      const json = error.toJSON();

      expect(json.code).toBe('TEST_ERROR');
      expect(json.message).toBe('Test error');
      expect(json.statusCode).toBe(500);
      expect(json.timestamp).toBeDefined();
      expect(json.retryable).toBe(false);
    });

    it('should include stack trace in development', () => {
      const oldEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'development';

      const error = new GatewayError('Test error', 'TEST_ERROR', 500, false);
      const json = error.toJSON();

      expect(json.stack).toBeDefined();

      process.env['NODE_ENV'] = oldEnv;
    });

    it('should exclude stack trace in production', () => {
      const oldEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'production';

      const error = new GatewayError('Test error', 'TEST_ERROR', 500, false);
      const json = error.toJSON();

      expect(json.stack).toBeUndefined();

      process.env['NODE_ENV'] = oldEnv;
    });
  });

  describe('UpstreamError', () => {
    it('should create upstream error with default values', () => {
      const error = new UpstreamError('Upstream failed');

      expect(error.name).toBe('UpstreamError');
      expect(error.code).toBe('UPSTREAM_ERROR');
      expect(error.statusCode).toBe(502);
      expect(error.retryable).toBe(true);
    });

    it('should allow custom values', () => {
      const error = new UpstreamError('Custom error', 'CUSTOM_CODE', 503, false);

      expect(error.code).toBe('CUSTOM_CODE');
      expect(error.statusCode).toBe(503);
      expect(error.retryable).toBe(false);
    });
  });

  describe('TimeoutError', () => {
    it('should create timeout error with type', () => {
      const error = new TimeoutError('Request timed out', 'request', 5000);

      expect(error.name).toBe('TimeoutError');
      expect(error.timeoutType).toBe('request');
      expect(error.timeoutMs).toBe(5000);
      expect(error.statusCode).toBe(504);
      expect(error.retryable).toBe(true);
    });

    it('should serialize with timeout information', () => {
      const error = new TimeoutError('Request timed out', 'upstream', 3000);
      const json = error.toJSON();

      expect(json.timeoutType).toBe('upstream');
      expect(json.timeoutMs).toBe(3000);
    });

    it('should support different timeout types', () => {
      const types: Array<'connection' | 'request' | 'upstream' | 'plugin'> = [
        'connection',
        'request',
        'upstream',
        'plugin',
      ];

      for (const type of types) {
        const error = new TimeoutError(`${type} timeout`, type, 1000);
        expect(error.timeoutType).toBe(type);
      }
    });
  });

  describe('ValidationError', () => {
    it('should create validation error with errors', () => {
      const validationErrors = [
        { field: 'email', message: 'Invalid email' },
        { field: 'password', message: 'Too short' },
      ];

      const error = new ValidationError('Validation failed', validationErrors);

      expect(error.name).toBe('ValidationError');
      expect(error.validationErrors).toEqual(validationErrors);
      expect(error.statusCode).toBe(400);
      expect(error.retryable).toBe(false);
    });

    it('should serialize with validation errors', () => {
      const validationErrors = [{ field: 'test', message: 'Test error' }];
      const error = new ValidationError('Validation failed', validationErrors);
      const json = error.toJSON();

      expect(json.validationErrors).toEqual(validationErrors);
    });
  });

  describe('PluginError', () => {
    it('should create plugin error with plugin info', () => {
      const error = new PluginError(
        'Plugin execution failed',
        'auth-plugin',
        'preRoute'
      );

      expect(error.name).toBe('PluginError');
      expect(error.pluginName).toBe('auth-plugin');
      expect(error.hook).toBe('preRoute');
      expect(error.statusCode).toBe(500);
      expect(error.retryable).toBe(false);
    });

    it('should serialize with plugin information', () => {
      const error = new PluginError('Plugin failed', 'test-plugin', 'postHandler');
      const json = error.toJSON();

      expect(json.pluginName).toBe('test-plugin');
      expect(json.hook).toBe('postHandler');
    });
  });

  describe('CircuitBreakerError', () => {
    it('should create circuit breaker error', () => {
      const error = new CircuitBreakerError(
        'Circuit breaker open',
        'backend-1',
        'OPEN'
      );

      expect(error.name).toBe('CircuitBreakerError');
      expect(error.upstreamId).toBe('backend-1');
      expect(error.circuitState).toBe('OPEN');
      expect(error.statusCode).toBe(503);
      expect(error.retryable).toBe(false);
    });

    it('should serialize with circuit breaker info', () => {
      const error = new CircuitBreakerError('Circuit open', 'backend', 'OPEN');
      const json = error.toJSON();

      expect(json.upstreamId).toBe('backend');
      expect(json.circuitState).toBe('OPEN');
    });
  });

  describe('ConnectionError', () => {
    it('should create connection error', () => {
      const error = new ConnectionError('Connection failed', 'pool-1');

      expect(error.name).toBe('ConnectionError');
      expect(error.poolId).toBe('pool-1');
      expect(error.statusCode).toBe(503);
      expect(error.retryable).toBe(true);
    });

    it('should serialize with pool ID', () => {
      const error = new ConnectionError('Connection error', 'pool-2');
      const json = error.toJSON();

      expect(json.poolId).toBe('pool-2');
    });
  });

  describe('isRetryable', () => {
    it('should return retryable flag for GatewayError', () => {
      const retryable = new GatewayError('Error', 'CODE', 500, true);
      const notRetryable = new GatewayError('Error', 'CODE', 500, false);

      expect(isRetryable(retryable)).toBe(true);
      expect(isRetryable(notRetryable)).toBe(false);
    });

    it('should detect retryable network errors', () => {
      expect(isRetryable(new Error('Connection timeout'))).toBe(true);
      expect(isRetryable(new Error('ECONNREFUSED'))).toBe(true);
      expect(isRetryable(new Error('ECONNRESET'))).toBe(true);
      expect(isRetryable(new Error('EHOSTUNREACH'))).toBe(true);
    });

    it('should detect non-retryable errors', () => {
      expect(isRetryable(new Error('Invalid request'))).toBe(false);
      expect(isRetryable(new Error('Bad request'))).toBe(false);
    });
  });

  describe('getStatusCode', () => {
    it('should return status code for GatewayError', () => {
      const error = new GatewayError('Error', 'CODE', 503, false);
      expect(getStatusCode(error)).toBe(503);
    });

    it('should detect status codes from error messages', () => {
      expect(getStatusCode(new Error('Request timeout'))).toBe(504);
      expect(getStatusCode(new Error('Not found'))).toBe(404);
      expect(getStatusCode(new Error('Unauthorized access'))).toBe(403);
      expect(getStatusCode(new Error('Bad request'))).toBe(400);
      expect(getStatusCode(new Error('Service unavailable'))).toBe(503);
    });

    it('should default to 500 for unknown errors', () => {
      expect(getStatusCode(new Error('Unknown error'))).toBe(500);
    });
  });

  describe('wrapError', () => {
    it('should return GatewayError unchanged', () => {
      const error = new GatewayError('Test', 'CODE', 500, false);
      const wrapped = wrapError(error);

      expect(wrapped).toBe(error);
    });

    it('should wrap timeout error', () => {
      const error = new Error('Request timeout');
      const wrapped = wrapError(error);

      expect(wrapped).toBeInstanceOf(TimeoutError);
      expect(wrapped.statusCode).toBe(504);
      expect(wrapped.originalError).toBe(error);
    });

    it('should wrap circuit breaker error', () => {
      const error = new Error('Circuit breaker is OPEN');
      const wrapped = wrapError(error);

      expect(wrapped).toBeInstanceOf(CircuitBreakerError);
      expect(wrapped.statusCode).toBe(503);
    });

    it('should wrap connection error', () => {
      const error = new Error('ECONNREFUSED');
      const wrapped = wrapError(error);

      expect(wrapped).toBeInstanceOf(ConnectionError);
      expect(wrapped.statusCode).toBe(503);
    });

    it('should wrap upstream error', () => {
      const error = new Error('Upstream service error');
      const wrapped = wrapError(error);

      expect(wrapped).toBeInstanceOf(UpstreamError);
    });

    it('should include request context when wrapping', () => {
      const error = new Error('Test error');
      const requestContext = { requestId: 'req-123', route: '/api/test' };
      const wrapped = wrapError(error, requestContext);

      expect(wrapped.requestContext).toEqual(requestContext);
    });

    it('should default to GatewayError for unknown errors', () => {
      const error = new Error('Unknown error');
      const wrapped = wrapError(error);

      expect(wrapped).toBeInstanceOf(GatewayError);
      expect(wrapped.code).toBe('GATEWAY_ERROR');
    });
  });
});
