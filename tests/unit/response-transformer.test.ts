/**
 * Unit tests for Response Transformer
 * Phase 6: Proxy Logic & Request Forwarding
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ResponseTransformer } from '../../src/core/response-transformer.js';

describe('ResponseTransformer', () => {
  let transformer: ResponseTransformer;

  beforeEach(() => {
    transformer = new ResponseTransformer();
  });

  describe('Header Transformations', () => {
    it('should add response headers', async () => {
      transformer.addTransformation({
        headers: {
          add: {
            'x-gateway-version': '1.0.0',
            'x-response-time': '50ms',
          },
        },
      });

      const result = await transformer.transform(
        '/api/test',
        200,
        { 'content-type': 'application/json' }
      );

      expect(result.headers['x-gateway-version']).toBe('1.0.0');
      expect(result.headers['x-response-time']).toBe('50ms');
      expect(result.headers['content-type']).toBe('application/json');
    });

    it('should remove response headers', async () => {
      transformer.addTransformation({
        headers: {
          remove: ['x-upstream-server', 'x-internal-id'],
        },
      });

      const result = await transformer.transform(
        '/api/test',
        200,
        {
          'content-type': 'application/json',
          'x-upstream-server': 'backend-1',
          'x-internal-id': '12345',
        }
      );

      expect(result.headers['x-upstream-server']).toBeUndefined();
      expect(result.headers['x-internal-id']).toBeUndefined();
      expect(result.headers['content-type']).toBe('application/json');
    });

    it('should remove response headers by wildcard', async () => {
      transformer.addTransformation({
        headers: {
          remove: ['x-upstream-*'],
        },
      });

      const result = await transformer.transform(
        '/api/test',
        200,
        {
          'content-type': 'application/json',
          'x-upstream-server': 'backend-1',
          'x-upstream-region': 'us-east',
          'x-public': 'visible',
        }
      );

      expect(result.headers['x-upstream-server']).toBeUndefined();
      expect(result.headers['x-upstream-region']).toBeUndefined();
      expect(result.headers['x-public']).toBe('visible');
    });

    it('should rename response headers', async () => {
      transformer.addTransformation({
        headers: {
          rename: {
            'x-server-id': 'x-gateway-id',
            'x-old': 'x-new',
          },
        },
      });

      const result = await transformer.transform(
        '/api/test',
        200,
        {
          'x-server-id': 'srv-123',
          'x-old': 'value',
        }
      );

      expect(result.headers['x-server-id']).toBeUndefined();
      expect(result.headers['x-gateway-id']).toBe('srv-123');
      expect(result.headers['x-old']).toBeUndefined();
      expect(result.headers['x-new']).toBe('value');
    });
  });

  describe('Status Code Mapping', () => {
    it('should map status codes', async () => {
      transformer.addTransformation({
        statusCodeMap: {
          404: 200,
          503: 500,
        },
      });

      const result1 = await transformer.transform('/api/test', 404, {});
      expect(result1.statusCode).toBe(200);

      const result2 = await transformer.transform('/api/test', 503, {});
      expect(result2.statusCode).toBe(500);

      const result3 = await transformer.transform('/api/test', 200, {});
      expect(result3.statusCode).toBe(200);
    });

    it('should preserve unmapped status codes', async () => {
      transformer.addTransformation({
        statusCodeMap: {
          404: 200,
        },
      });

      const result = await transformer.transform('/api/test', 201, {});
      expect(result.statusCode).toBe(201);
    });
  });

  describe('CORS Handling', () => {
    it('should add CORS headers for wildcard origin', async () => {
      transformer.addTransformation({
        cors: {
          enabled: true,
          origins: ['*'],
          methods: ['GET', 'POST', 'PUT', 'DELETE'],
          credentials: true,
        },
      });

      const result = await transformer.transform('/api/test', 200, {});

      expect(result.headers['access-control-allow-origin']).toBe('*');
      expect(result.headers['access-control-allow-methods']).toBe('GET, POST, PUT, DELETE');
      expect(result.headers['access-control-allow-credentials']).toBe('true');
    });

    it('should add CORS headers for specific origin', async () => {
      transformer.addTransformation({
        cors: {
          enabled: true,
          origins: ['https://example.com'],
          methods: ['GET', 'POST'],
        },
      });

      const result = await transformer.transform('/api/test', 200, {});

      expect(result.headers['access-control-allow-origin']).toBe('https://example.com');
      expect(result.headers['access-control-allow-methods']).toBe('GET, POST');
    });

    it('should add allowed headers in CORS', async () => {
      transformer.addTransformation({
        cors: {
          enabled: true,
          origins: ['*'],
          methods: ['GET'],
          allowedHeaders: ['Content-Type', 'Authorization'],
        },
      });

      const result = await transformer.transform('/api/test', 200, {});

      expect(result.headers['access-control-allow-headers']).toBe('Content-Type, Authorization');
    });

    it('should add exposed headers in CORS', async () => {
      transformer.addTransformation({
        cors: {
          enabled: true,
          origins: ['*'],
          methods: ['GET'],
          exposedHeaders: ['X-Total-Count', 'X-Page-Size'],
        },
      });

      const result = await transformer.transform('/api/test', 200, {});

      expect(result.headers['access-control-expose-headers']).toBe('X-Total-Count, X-Page-Size');
    });

    it('should add max age in CORS', async () => {
      transformer.addTransformation({
        cors: {
          enabled: true,
          origins: ['*'],
          methods: ['GET'],
          maxAge: 3600,
        },
      });

      const result = await transformer.transform('/api/test', 200, {});

      expect(result.headers['access-control-max-age']).toBe('3600');
    });

    it('should not add CORS headers when disabled', async () => {
      transformer.addTransformation({
        cors: {
          enabled: false,
          origins: ['*'],
          methods: ['GET'],
        },
      });

      const result = await transformer.transform('/api/test', 200, {});

      expect(result.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('Error Response Templates', () => {
    it('should apply error template for 404', async () => {
      transformer.addTransformation({
        errorTemplates: [
          {
            statusCodes: [404],
            body: { error: 'Not Found', message: 'Resource not found' },
            headers: { 'x-error-handler': 'gateway' },
          },
        ],
      });

      const result = await transformer.transform(
        '/api/test',
        404,
        { 'content-type': 'application/json' }
      );

      const body = JSON.parse(result.body!.toString('utf-8'));
      expect(body.error).toBe('Not Found');
      expect(body.message).toBe('Resource not found');
      expect(result.headers['x-error-handler']).toBe('gateway');
    });

    it('should apply error template with string body', async () => {
      transformer.addTransformation({
        errorTemplates: [
          {
            statusCodes: [500],
            body: 'Internal Server Error',
          },
        ],
      });

      const result = await transformer.transform('/api/test', 500, {});

      expect(result.body!.toString('utf-8')).toBe('Internal Server Error');
    });

    it('should apply error template for multiple status codes', async () => {
      transformer.addTransformation({
        errorTemplates: [
          {
            statusCodes: [400, 401, 403],
            body: { error: 'Client Error' },
          },
        ],
      });

      const result1 = await transformer.transform('/api/test', 400, {});
      const body1 = JSON.parse(result1.body!.toString('utf-8'));
      expect(body1.error).toBe('Client Error');

      const result2 = await transformer.transform('/api/test', 403, {});
      const body2 = JSON.parse(result2.body!.toString('utf-8'));
      expect(body2.error).toBe('Client Error');
    });

    it('should not apply error template for success status', async () => {
      transformer.addTransformation({
        errorTemplates: [
          {
            statusCodes: [404],
            body: { error: 'Not Found' },
          },
        ],
      });

      const result = await transformer.transform('/api/test', 200, {});

      expect(result.body).toBeUndefined();
    });
  });

  describe('Body Transformations', () => {
    it('should set fields in JSON response', async () => {
      transformer.addTransformation({
        body: {
          json: {
            set: {
              'metadata.source': 'gateway',
              'version': '1.0',
            },
          },
        },
      });

      const bodyData = { data: 'test' };
      const body = Buffer.from(JSON.stringify(bodyData), 'utf-8');

      const result = await transformer.transform(
        '/api/test',
        200,
        { 'content-type': 'application/json' },
        body
      );

      const transformed = JSON.parse(result.body!.toString('utf-8'));
      expect(transformed.data).toBe('test');
      expect(transformed.metadata.source).toBe('gateway');
      expect(transformed.version).toBe('1.0');
    });

    it('should remove fields from JSON response', async () => {
      transformer.addTransformation({
        body: {
          json: {
            remove: ['sensitive', 'internal'],
          },
        },
      });

      const bodyData = {
        data: 'public',
        sensitive: 'secret',
        internal: 'private',
      };
      const body = Buffer.from(JSON.stringify(bodyData), 'utf-8');

      const result = await transformer.transform(
        '/api/test',
        200,
        { 'content-type': 'application/json' },
        body
      );

      const transformed = JSON.parse(result.body!.toString('utf-8'));
      expect(transformed.data).toBe('public');
      expect(transformed.sensitive).toBeUndefined();
      expect(transformed.internal).toBeUndefined();
    });

    it('should wrap JSON response in a field', async () => {
      transformer.addTransformation({
        body: {
          json: {
            wrap: 'data',
          },
        },
      });

      const bodyData = { user: 'john', id: 123 };
      const body = Buffer.from(JSON.stringify(bodyData), 'utf-8');

      const result = await transformer.transform(
        '/api/test',
        200,
        { 'content-type': 'application/json' },
        body
      );

      const transformed = JSON.parse(result.body!.toString('utf-8'));
      expect(transformed.data).toEqual(bodyData);
    });
  });

  describe('Conditional Transformations', () => {
    it('should apply transformation based on route pattern', async () => {
      transformer.addTransformation({
        routes: ['/api/v1/*'],
        headers: {
          add: { 'x-api-version': 'v1' },
        },
      });

      // Should apply
      const result1 = await transformer.transform('/api/v1/users', 200, {});
      expect(result1.headers['x-api-version']).toBe('v1');

      // Should not apply
      const result2 = await transformer.transform('/api/v2/users', 200, {});
      expect(result2.headers['x-api-version']).toBeUndefined();
    });

    it('should apply transformation based on status code condition', async () => {
      transformer.addTransformation({
        conditions: {
          statusCode: 404,
        },
        headers: {
          add: { 'x-not-found': 'true' },
        },
      });

      // Should apply
      const result1 = await transformer.transform('/api/test', 404, {});
      expect(result1.headers['x-not-found']).toBe('true');

      // Should not apply
      const result2 = await transformer.transform('/api/test', 200, {});
      expect(result2.headers['x-not-found']).toBeUndefined();
    });

    it('should apply transformation based on multiple status codes', async () => {
      transformer.addTransformation({
        conditions: {
          statusCode: [400, 401, 403, 404],
        },
        headers: {
          add: { 'x-client-error': 'true' },
        },
      });

      const result1 = await transformer.transform('/api/test', 400, {});
      expect(result1.headers['x-client-error']).toBe('true');

      const result2 = await transformer.transform('/api/test', 404, {});
      expect(result2.headers['x-client-error']).toBe('true');

      const result3 = await transformer.transform('/api/test', 500, {});
      expect(result3.headers['x-client-error']).toBeUndefined();
    });

    it('should apply transformation based on header condition', async () => {
      transformer.addTransformation({
        conditions: {
          header: { name: 'x-upstream', value: 'backend-1' },
        },
        headers: {
          add: { 'x-routed-to': 'backend-1' },
        },
      });

      // Should apply
      const result1 = await transformer.transform(
        '/api/test',
        200,
        { 'x-upstream': 'backend-1' }
      );
      expect(result1.headers['x-routed-to']).toBe('backend-1');

      // Should not apply
      const result2 = await transformer.transform(
        '/api/test',
        200,
        { 'x-upstream': 'backend-2' }
      );
      expect(result2.headers['x-routed-to']).toBeUndefined();
    });

    it('should apply transformation based on content-type condition', async () => {
      transformer.addTransformation({
        conditions: {
          contentType: 'application/json',
        },
        headers: {
          add: { 'x-json-response': 'true' },
        },
      });

      // Should apply
      const result1 = await transformer.transform(
        '/api/test',
        200,
        { 'content-type': 'application/json; charset=utf-8' }
      );
      expect(result1.headers['x-json-response']).toBe('true');

      // Should not apply
      const result2 = await transformer.transform(
        '/api/test',
        200,
        { 'content-type': 'text/html' }
      );
      expect(result2.headers['x-json-response']).toBeUndefined();
    });
  });

  describe('Transformation Chains', () => {
    it('should apply multiple transformations in priority order', async () => {
      transformer.addTransformation({
        priority: 10,
        headers: {
          add: { 'x-first': 'first' },
        },
      });

      transformer.addTransformation({
        priority: 5,
        headers: {
          add: { 'x-second': 'second' },
        },
      });

      const result = await transformer.transform('/api/test', 200, {});

      expect(result.headers['x-first']).toBe('first');
      expect(result.headers['x-second']).toBe('second');
    });

    it('should apply all matching transformations', async () => {
      transformer.addTransformation({
        routes: ['/api/*'],
        headers: {
          add: { 'x-api': 'true' },
        },
      });

      transformer.addTransformation({
        conditions: {
          statusCode: 200,
        },
        headers: {
          add: { 'x-success': 'true' },
        },
      });

      const result = await transformer.transform('/api/users', 200, {});

      expect(result.headers['x-api']).toBe('true');
      expect(result.headers['x-success']).toBe('true');
    });
  });

  describe('Performance', () => {
    it('should complete transformation within 0.5ms', async () => {
      transformer.addTransformation({
        headers: {
          add: { 'x-gateway': 'test' },
          remove: ['x-upstream'],
        },
        statusCodeMap: {
          404: 200,
        },
      });

      const result = await transformer.transform(
        '/api/test',
        404,
        { 'content-type': 'application/json', 'x-upstream': 'backend' }
      );

      expect(result.duration).toBeLessThan(0.5);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty transformations', async () => {
      const result = await transformer.transform(
        '/api/test',
        200,
        { 'content-type': 'application/json' }
      );

      expect(result.statusCode).toBe(200);
      expect(result.headers).toEqual({ 'content-type': 'application/json' });
    });

    it('should handle invalid JSON body gracefully', async () => {
      transformer.addTransformation({
        body: {
          json: {
            set: { 'field': 'value' },
          },
        },
      });

      const body = Buffer.from('invalid json', 'utf-8');

      const result = await transformer.transform(
        '/api/test',
        200,
        { 'content-type': 'application/json' },
        body
      );

      // Should return original body on error
      expect(result.body).toEqual(body);
    });

    it('should clear all transformations', () => {
      transformer.addTransformation({
        headers: {
          add: { 'x-test': 'test' },
        },
      });

      const stats1 = transformer.getStats();
      expect(stats1.totalTransformations).toBe(1);

      transformer.clear();

      const stats2 = transformer.getStats();
      expect(stats2.totalTransformations).toBe(0);
    });
  });
});
