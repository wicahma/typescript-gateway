/**
 * Unit tests for Request Transformer
 * Phase 6: Proxy Logic & Request Forwarding
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RequestTransformer } from '../../src/core/request-transformer.js';

describe('RequestTransformer', () => {
  let transformer: RequestTransformer;

  beforeEach(() => {
    transformer = new RequestTransformer();
  });

  describe('Header Transformations', () => {
    it('should add headers', async () => {
      transformer.addTransformation({
        headers: {
          add: {
            'x-gateway': 'test',
            'x-version': '1.0',
          },
        },
      });

      const result = await transformer.transform(
        'GET',
        '/api/test',
        { 'content-type': 'application/json' }
      );

      expect(result.headers['x-gateway']).toBe('test');
      expect(result.headers['x-version']).toBe('1.0');
      expect(result.headers['content-type']).toBe('application/json');
    });

    it('should remove headers by exact name', async () => {
      transformer.addTransformation({
        headers: {
          remove: ['x-internal', 'x-debug'],
        },
      });

      const result = await transformer.transform(
        'GET',
        '/api/test',
        {
          'content-type': 'application/json',
          'x-internal': 'secret',
          'x-debug': 'true',
        }
      );

      expect(result.headers['x-internal']).toBeUndefined();
      expect(result.headers['x-debug']).toBeUndefined();
      expect(result.headers['content-type']).toBe('application/json');
    });

    it('should remove headers by wildcard pattern', async () => {
      transformer.addTransformation({
        headers: {
          remove: ['x-internal-*'],
        },
      });

      const result = await transformer.transform(
        'GET',
        '/api/test',
        {
          'content-type': 'application/json',
          'x-internal-token': 'secret',
          'x-internal-id': '123',
          'x-external': 'public',
        }
      );

      expect(result.headers['x-internal-token']).toBeUndefined();
      expect(result.headers['x-internal-id']).toBeUndefined();
      expect(result.headers['x-external']).toBe('public');
      expect(result.headers['content-type']).toBe('application/json');
    });

    it('should rename headers', async () => {
      transformer.addTransformation({
        headers: {
          rename: {
            'x-user-id': 'x-client-id',
            'x-old-header': 'x-new-header',
          },
        },
      });

      const result = await transformer.transform(
        'GET',
        '/api/test',
        {
          'x-user-id': '12345',
          'x-old-header': 'value',
        }
      );

      expect(result.headers['x-user-id']).toBeUndefined();
      expect(result.headers['x-client-id']).toBe('12345');
      expect(result.headers['x-old-header']).toBeUndefined();
      expect(result.headers['x-new-header']).toBe('value');
    });

    it('should modify headers with string replacement', async () => {
      transformer.addTransformation({
        headers: {
          modify: {
            'user-agent': {
              pattern: 'Chrome',
              replacement: 'Gateway',
            },
          },
        },
      });

      const result = await transformer.transform(
        'GET',
        '/api/test',
        {
          'user-agent': 'Mozilla/5.0 Chrome/91.0',
        }
      );

      expect(result.headers['user-agent']).toBe('Mozilla/5.0 Gateway/91.0');
    });

    it('should modify headers with regex pattern', async () => {
      transformer.addTransformation({
        headers: {
          modify: {
            authorization: {
              pattern: /Bearer\s+/g,
              replacement: 'Token ',
            },
          },
        },
      });

      const result = await transformer.transform(
        'GET',
        '/api/test',
        {
          authorization: 'Bearer abc123',
        }
      );

      expect(result.headers['authorization']).toBe('Token abc123');
    });
  });

  describe('Query Parameter Transformations', () => {
    it('should add query parameters', async () => {
      transformer.addTransformation({
        query: {
          add: {
            'api_version': '2',
            'client': 'gateway',
          },
        },
      });

      const result = await transformer.transform(
        'GET',
        '/api/test?existing=value',
        {}
      );

      expect(result.path).toContain('api_version=2');
      expect(result.path).toContain('client=gateway');
      expect(result.path).toContain('existing=value');
    });

    it('should remove query parameters', async () => {
      transformer.addTransformation({
        query: {
          remove: ['internal', 'debug'],
        },
      });

      const result = await transformer.transform(
        'GET',
        '/api/test?param=value&internal=secret&debug=true',
        {}
      );

      expect(result.path).not.toContain('internal');
      expect(result.path).not.toContain('debug');
      expect(result.path).toContain('param=value');
    });

    it('should modify query parameters', async () => {
      transformer.addTransformation({
        query: {
          modify: {
            version: '2.0',
            format: 'json',
          },
        },
      });

      const result = await transformer.transform(
        'GET',
        '/api/test?version=1.0&format=xml',
        {}
      );

      expect(result.path).toContain('version=2.0');
      expect(result.path).toContain('format=json');
    });
  });

  describe('Path Rewriting', () => {
    it('should rewrite path with string pattern', async () => {
      transformer.addTransformation({
        pathRewrite: [
          {
            pattern: '^/api/v1',
            replacement: '/api/v2',
          },
        ],
      });

      const result = await transformer.transform(
        'GET',
        '/api/v1/users',
        {}
      );

      expect(result.path).toBe('/api/v2/users');
    });

    it('should rewrite path with regex pattern', async () => {
      transformer.addTransformation({
        pathRewrite: [
          {
            pattern: /^\/old-api/,
            replacement: '/new-api',
          },
        ],
      });

      const result = await transformer.transform(
        'GET',
        '/old-api/resource',
        {}
      );

      expect(result.path).toBe('/new-api/resource');
    });

    it('should apply multiple path rewrites in order', async () => {
      transformer.addTransformation({
        pathRewrite: [
          {
            pattern: '^/api',
            replacement: '/service',
          },
          {
            pattern: '/v1',
            replacement: '/v2',
          },
        ],
      });

      const result = await transformer.transform(
        'GET',
        '/api/v1/users',
        {}
      );

      expect(result.path).toBe('/service/v2/users');
    });

    it('should preserve query string after path rewrite', async () => {
      transformer.addTransformation({
        pathRewrite: [
          {
            pattern: '^/api/v1',
            replacement: '/api/v2',
          },
        ],
      });

      const result = await transformer.transform(
        'GET',
        '/api/v1/users?page=1&limit=10',
        {}
      );

      expect(result.path).toContain('/api/v2/users');
      expect(result.path).toContain('page=1');
      expect(result.path).toContain('limit=10');
    });
  });

  describe('Body Transformations', () => {
    it('should transform JSON body - set fields', async () => {
      transformer.addTransformation({
        body: {
          json: {
            set: {
              'metadata.source': 'gateway',
              'timestamp': Date.now(),
            },
          },
        },
      });

      const bodyData = { user: 'john', email: 'john@example.com' };
      const body = Buffer.from(JSON.stringify(bodyData), 'utf-8');

      const result = await transformer.transform(
        'POST',
        '/api/users',
        { 'content-type': 'application/json' },
        body
      );

      const transformed = JSON.parse(result.body!.toString('utf-8'));
      expect(transformed.user).toBe('john');
      expect(transformed.email).toBe('john@example.com');
      expect(transformed.metadata.source).toBe('gateway');
      expect(transformed.timestamp).toBeDefined();
    });

    it('should transform JSON body - remove fields', async () => {
      transformer.addTransformation({
        body: {
          json: {
            remove: ['password', 'internal'],
          },
        },
      });

      const bodyData = {
        user: 'john',
        password: 'secret',
        internal: 'data',
        email: 'john@example.com',
      };
      const body = Buffer.from(JSON.stringify(bodyData), 'utf-8');

      const result = await transformer.transform(
        'POST',
        '/api/users',
        { 'content-type': 'application/json' },
        body
      );

      const transformed = JSON.parse(result.body!.toString('utf-8'));
      expect(transformed.user).toBe('john');
      expect(transformed.email).toBe('john@example.com');
      expect(transformed.password).toBeUndefined();
      expect(transformed.internal).toBeUndefined();
    });

    it('should transform form data body - set fields', async () => {
      transformer.addTransformation({
        body: {
          formData: {
            set: {
              'client': 'gateway',
              'version': '1.0',
            },
          },
        },
      });

      const body = Buffer.from('user=john&email=john@example.com', 'utf-8');

      const result = await transformer.transform(
        'POST',
        '/api/users',
        { 'content-type': 'application/x-www-form-urlencoded' },
        body
      );

      const transformed = result.body!.toString('utf-8');
      expect(transformed).toContain('user=john');
      expect(transformed).toMatch(/email=john(%40|@)example\.com/);
      expect(transformed).toContain('client=gateway');
      expect(transformed).toContain('version=1.0');
    });

    it('should transform form data body - remove fields', async () => {
      transformer.addTransformation({
        body: {
          formData: {
            remove: ['password'],
          },
        },
      });

      const body = Buffer.from('user=john&password=secret&email=john@example.com', 'utf-8');

      const result = await transformer.transform(
        'POST',
        '/api/users',
        { 'content-type': 'application/x-www-form-urlencoded' },
        body
      );

      const transformed = result.body!.toString('utf-8');
      expect(transformed).toContain('user=john');
      expect(transformed).toMatch(/email=john(%40|@)example\.com/);
      expect(transformed).not.toContain('password');
    });
  });

  describe('Conditional Transformations', () => {
    it('should apply transformation based on route pattern', async () => {
      transformer.addTransformation({
        routes: ['/api/*'],
        headers: {
          add: { 'x-api-gateway': 'true' },
        },
      });

      // Should apply
      const result1 = await transformer.transform(
        'GET',
        '/api/users',
        {}
      );
      expect(result1.headers['x-api-gateway']).toBe('true');

      // Should not apply
      const result2 = await transformer.transform(
        'GET',
        '/other/path',
        {}
      );
      expect(result2.headers['x-api-gateway']).toBeUndefined();
    });

    it('should apply transformation based on header condition', async () => {
      transformer.addTransformation({
        conditions: {
          header: { name: 'x-client', value: 'mobile' },
        },
        headers: {
          add: { 'x-mobile-optimized': 'true' },
        },
      });

      // Should apply
      const result1 = await transformer.transform(
        'GET',
        '/api/users',
        { 'x-client': 'mobile' }
      );
      expect(result1.headers['x-mobile-optimized']).toBe('true');

      // Should not apply
      const result2 = await transformer.transform(
        'GET',
        '/api/users',
        { 'x-client': 'desktop' }
      );
      expect(result2.headers['x-mobile-optimized']).toBeUndefined();
    });

    it('should apply transformation based on method condition', async () => {
      transformer.addTransformation({
        conditions: {
          method: ['POST', 'PUT', 'PATCH'],
        },
        headers: {
          add: { 'x-mutating-request': 'true' },
        },
      });

      // Should apply
      const result1 = await transformer.transform(
        'POST',
        '/api/users',
        {}
      );
      expect(result1.headers['x-mutating-request']).toBe('true');

      // Should not apply
      const result2 = await transformer.transform(
        'GET',
        '/api/users',
        {}
      );
      expect(result2.headers['x-mutating-request']).toBeUndefined();
    });

    it('should apply transformation based on query param condition', async () => {
      transformer.addTransformation({
        conditions: {
          queryParam: 'debug',
        },
        headers: {
          add: { 'x-debug-mode': 'true' },
        },
      });

      // Should apply
      const result1 = await transformer.transform(
        'GET',
        '/api/users?debug=true',
        {}
      );
      expect(result1.headers['x-debug-mode']).toBe('true');

      // Should not apply
      const result2 = await transformer.transform(
        'GET',
        '/api/users',
        {}
      );
      expect(result2.headers['x-debug-mode']).toBeUndefined();
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

      const result = await transformer.transform(
        'GET',
        '/api/test',
        {}
      );

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
          method: 'GET',
        },
        headers: {
          add: { 'x-read-only': 'true' },
        },
      });

      const result = await transformer.transform(
        'GET',
        '/api/users',
        {}
      );

      expect(result.headers['x-api']).toBe('true');
      expect(result.headers['x-read-only']).toBe('true');
    });
  });

  describe('Performance', () => {
    it('should complete transformation within 0.5ms', async () => {
      transformer.addTransformation({
        headers: {
          add: { 'x-gateway': 'test' },
          remove: ['x-internal'],
        },
        query: {
          add: { 'version': '2' },
        },
      });

      const result = await transformer.transform(
        'GET',
        '/api/test?param=value',
        { 'content-type': 'application/json', 'x-internal': 'secret' }
      );

      expect(result.duration).toBeLessThan(0.5);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty transformations', async () => {
      const result = await transformer.transform(
        'GET',
        '/api/test',
        { 'content-type': 'application/json' }
      );

      expect(result.headers).toEqual({ 'content-type': 'application/json' });
      expect(result.path).toBe('/api/test');
    });

    it('should handle path without query string', async () => {
      transformer.addTransformation({
        query: {
          add: { 'version': '2' },
        },
      });

      const result = await transformer.transform(
        'GET',
        '/api/test',
        {}
      );

      expect(result.path).toBe('/api/test?version=2');
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
        'POST',
        '/api/test',
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
