/**
 * Tests for built-in plugins
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequestIdPlugin } from '../../src/plugins/builtin/request-id.js';
import { createResponseTimePlugin } from '../../src/plugins/builtin/response-time.js';
import { createRequestLoggerPlugin } from '../../src/plugins/builtin/request-logger.js';
import { createHeaderTransformerPlugin } from '../../src/plugins/builtin/header-transformer.js';
import { RequestContext, HttpMethod } from '../../src/types/core.js';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';

// Helper to create mock context
function createMockContext(): RequestContext {
  const mockRes = {
    statusCode: 200,
    setHeader: function (name: string, value: string | number | readonly string[]): this {
      if (!this.headers) {
        this.headers = {};
      }
      this.headers[name] = value;
      return this;
    },
    getHeader: function (name: string): string | number | string[] | undefined {
      return this.headers?.[name];
    },
    getHeaders: function (): Record<string, string | number | string[]> {
      return this.headers || {};
    },
    removeHeader: function (name: string): void {
      if (this.headers) {
        delete this.headers[name];
      }
    },
    headers: {} as Record<string, string | number | string[] | undefined>,
  } as unknown as ServerResponse;

  const mockReq = {
    socket: {
      remoteAddress: '127.0.0.1',
    } as Socket,
  } as IncomingMessage;

  return {
    requestId: 'test-req-1',
    startTime: process.hrtime.bigint(),
    method: 'GET' as HttpMethod,
    path: '/test',
    query: null,
    params: {},
    headers: {},
    body: null,
    req: mockReq,
    res: mockRes,
    upstream: null,
    state: {},
    responded: false,
    route: null,
    timestamps: {},
  };
}

describe('Built-in Plugins', () => {
  describe('RequestIdPlugin', () => {
    it('should generate request ID', () => {
      const plugin = createRequestIdPlugin();
      const ctx = createMockContext();
      // Initialize plugin context
      ctx.state['__plugins'] = new Map();

      plugin.preRoute?.(ctx);

      expect(ctx.requestId).toBeTruthy();
      expect(ctx.requestId).toContain('req-');
      expect(ctx.res.getHeader('x-request-id')).toBe(ctx.requestId);
    });

    it('should preserve existing request ID', () => {
      const plugin = createRequestIdPlugin({ overwrite: false });
      const ctx = createMockContext();
      ctx.headers['x-request-id'] = 'existing-id';
      // Initialize plugin context
      ctx.state['__plugins'] = new Map();

      plugin.preRoute?.(ctx);

      expect(ctx.requestId).toBe('existing-id');
    });

    it('should overwrite existing request ID when configured', () => {
      const plugin = createRequestIdPlugin({ overwrite: true });
      const ctx = createMockContext();
      ctx.headers['x-request-id'] = 'existing-id';
      // Initialize plugin context
      ctx.state['__plugins'] = new Map();

      plugin.preRoute?.(ctx);

      expect(ctx.requestId).not.toBe('existing-id');
      expect(ctx.requestId).toContain('req-');
    });

    it('should use custom header name', () => {
      const plugin = createRequestIdPlugin({ headerName: 'x-correlation-id' });
      const ctx = createMockContext();
      // Initialize plugin context
      ctx.state['__plugins'] = new Map();

      plugin.preRoute?.(ctx);

      expect(ctx.res.getHeader('x-correlation-id')).toBe(ctx.requestId);
    });

    it('should use custom prefix', () => {
      const plugin = createRequestIdPlugin({ prefix: 'custom-' });
      const ctx = createMockContext();
      // Initialize plugin context
      ctx.state['__plugins'] = new Map();

      plugin.preRoute?.(ctx);

      expect(ctx.requestId).toContain('custom-');
    });
  });

  describe('ResponseTimePlugin', () => {
    it('should track response time', async () => {
      const plugin = createResponseTimePlugin();
      const ctx = createMockContext();
      // Initialize plugin context
      ctx.state['__plugins'] = new Map();

      plugin.preRoute?.(ctx);

      // Simulate some processing time
      await new Promise((resolve) => setTimeout(resolve, 10));

      plugin.postHandler?.(ctx);

      const header = ctx.res.getHeader('x-response-time');
      expect(header).toBeTruthy();
      expect(String(header)).toMatch(/\d+\.\d{2}ms/);
    });

    it('should use custom header name', async () => {
      const plugin = createResponseTimePlugin({ headerName: 'x-elapsed' });
      const ctx = createMockContext();
      // Initialize plugin context
      ctx.state['__plugins'] = new Map();

      plugin.preRoute?.(ctx);
      plugin.postHandler?.(ctx);

      expect(ctx.res.getHeader('x-elapsed')).toBeTruthy();
    });

    it('should use different units', async () => {
      const pluginUs = createResponseTimePlugin({ unit: 'us' });
      const ctx = createMockContext();
      // Initialize plugin context
      ctx.state['__plugins'] = new Map();

      pluginUs.preRoute?.(ctx);
      pluginUs.postHandler?.(ctx);

      const header = ctx.res.getHeader('x-response-time');
      expect(String(header)).toMatch(/μs$/);
    });

    it('should use custom decimal places', async () => {
      const plugin = createResponseTimePlugin({ decimals: 0 });
      const ctx = createMockContext();
      // Initialize plugin context
      ctx.state['__plugins'] = new Map();

      plugin.preRoute?.(ctx);
      plugin.postHandler?.(ctx);

      const header = ctx.res.getHeader('x-response-time');
      expect(String(header)).toMatch(/^\d+ms$/); // No decimal point
    });
  });

  describe('RequestLoggerPlugin', () => {
    it('should initialize with default config', () => {
      const plugin = createRequestLoggerPlugin();
      expect(plugin.name).toBe('request-logger');
      expect(plugin.version).toBe('1.0.0');
    });

    it('should log on request completion by default', () => {
      const plugin = createRequestLoggerPlugin();
      const ctx = createMockContext();
      
      // Initialize plugin context
      ctx.state['__plugins'] = new Map();

      // Should not throw
      plugin.postResponse?.(ctx);
    });

    it('should log on request start when configured', () => {
      const plugin = createRequestLoggerPlugin({ logOnStart: true });
      const ctx = createMockContext();
      
      // Initialize plugin context
      ctx.state['__plugins'] = new Map();

      // Should not throw
      plugin.preRoute?.(ctx);
    });

    it('should respect enabled flag', () => {
      const plugin = createRequestLoggerPlugin({ enabled: false });
      const ctx = createMockContext();

      // Should not log when disabled
      plugin.postResponse?.(ctx);
      // No easy way to verify, but should not throw
    });

    it('should include query parameters when configured', () => {
      const plugin = createRequestLoggerPlugin({ includeQuery: true });
      const ctx = createMockContext();
      ctx.query = { key: 'value' };
      
      // Initialize plugin context
      ctx.state['__plugins'] = new Map();

      plugin.postResponse?.(ctx);
      // Logging happens, no error expected
    });

    it('should include route parameters when configured', () => {
      const plugin = createRequestLoggerPlugin({ includeParams: true });
      const ctx = createMockContext();
      ctx.params = { id: '123' };
      
      // Initialize plugin context
      ctx.state['__plugins'] = new Map();

      plugin.postResponse?.(ctx);
      // Logging happens, no error expected
    });
  });

  describe('HeaderTransformerPlugin', () => {
    it('should add headers', () => {
      const plugin = createHeaderTransformerPlugin({
        rules: [
          {
            name: 'x-custom-header',
            action: 'add',
            value: 'custom-value',
            applyToResponse: true,
          },
        ],
      });

      const ctx = createMockContext();
      plugin.postHandler?.(ctx);

      expect(ctx.res.getHeader('x-custom-header')).toBe('custom-value');
    });

    it('should set headers', () => {
      const plugin = createHeaderTransformerPlugin({
        rules: [
          {
            name: 'x-custom-header',
            action: 'set',
            value: 'new-value',
            applyToResponse: true,
          },
        ],
      });

      const ctx = createMockContext();
      ctx.res.setHeader('x-custom-header', 'old-value');
      plugin.postHandler?.(ctx);

      expect(ctx.res.getHeader('x-custom-header')).toBe('new-value');
    });

    it('should remove headers', () => {
      const plugin = createHeaderTransformerPlugin({
        rules: [
          {
            name: 'x-remove-me',
            action: 'remove',
            applyToResponse: true,
          },
        ],
      });

      const ctx = createMockContext();
      ctx.res.setHeader('x-remove-me', 'value');
      plugin.postHandler?.(ctx);

      expect(ctx.res.getHeader('x-remove-me')).toBeUndefined();
    });

    it('should rename headers', () => {
      const plugin = createHeaderTransformerPlugin({
        rules: [
          {
            name: 'x-old-name',
            action: 'rename',
            newName: 'x-new-name',
            applyToResponse: true,
          },
        ],
      });

      const ctx = createMockContext();
      ctx.res.setHeader('x-old-name', 'value');
      plugin.postHandler?.(ctx);

      expect(ctx.res.getHeader('x-old-name')).toBeUndefined();
      expect(ctx.res.getHeader('x-new-name')).toBe('value');
    });

    it('should apply conditional transformations', () => {
      const plugin = createHeaderTransformerPlugin({
        rules: [
          {
            name: 'x-conditional',
            action: 'add',
            value: 'added',
            applyToResponse: true,
            condition: {
              header: 'content-type',
              contains: 'json',
            },
          },
        ],
      });

      const ctx = createMockContext();
      ctx.res.setHeader('content-type', 'application/json');
      plugin.postHandler?.(ctx);

      expect(ctx.res.getHeader('x-conditional')).toBe('added');
    });

    it('should not apply when condition not met', () => {
      const plugin = createHeaderTransformerPlugin({
        rules: [
          {
            name: 'x-conditional',
            action: 'add',
            value: 'added',
            applyToResponse: true,
            condition: {
              header: 'content-type',
              equals: 'application/json',
            },
          },
        ],
      });

      const ctx = createMockContext();
      ctx.res.setHeader('content-type', 'text/plain');
      plugin.postHandler?.(ctx);

      expect(ctx.res.getHeader('x-conditional')).toBeUndefined();
    });

    it('should transform request headers when configured', () => {
      const plugin = createHeaderTransformerPlugin({
        rules: [
          {
            name: 'x-request-header',
            action: 'add',
            value: 'added',
            applyToRequest: true,
          },
        ],
      });

      const ctx = createMockContext();
      plugin.preHandler?.(ctx);

      expect(ctx.headers['x-request-header']).toBe('added');
    });

    it('should respect transformRequest flag', () => {
      const plugin = createHeaderTransformerPlugin({
        transformRequest: false,
        rules: [
          {
            name: 'x-request-header',
            action: 'add',
            value: 'added',
            applyToRequest: true,
          },
        ],
      });

      const ctx = createMockContext();
      plugin.preHandler?.(ctx);

      // Should not add because transformRequest is false
      expect(ctx.headers['x-request-header']).toBeUndefined();
    });

    it('should respect transformResponse flag', () => {
      const plugin = createHeaderTransformerPlugin({
        transformResponse: false,
        rules: [
          {
            name: 'x-response-header',
            action: 'add',
            value: 'added',
            applyToResponse: true,
          },
        ],
      });

      const ctx = createMockContext();
      plugin.postHandler?.(ctx);

      // Should not add because transformResponse is false
      expect(ctx.res.getHeader('x-response-header')).toBeUndefined();
    });
  });

  describe('Plugin integration', () => {
    it('should work together in a chain', async () => {
      const requestIdPlugin = createRequestIdPlugin();
      const responseTimePlugin = createResponseTimePlugin();
      const headerPlugin = createHeaderTransformerPlugin({
        rules: [
          {
            name: 'x-powered-by',
            action: 'set',
            value: 'Gateway',
            applyToResponse: true,
          },
        ],
      });

      const ctx = createMockContext();
      
      // Initialize plugin context
      ctx.state['__plugins'] = new Map();

      // Simulate request flow
      requestIdPlugin.preRoute?.(ctx);
      responseTimePlugin.preRoute?.(ctx);

      await new Promise((resolve) => setTimeout(resolve, 5));

      headerPlugin.postHandler?.(ctx);
      responseTimePlugin.postHandler?.(ctx);

      // Verify all plugins worked
      expect(ctx.requestId).toBeTruthy();
      expect(ctx.res.getHeader('x-request-id')).toBe(ctx.requestId);
      expect(ctx.res.getHeader('x-response-time')).toBeTruthy();
      expect(ctx.res.getHeader('x-powered-by')).toBe('Gateway');
    });
  });

  describe('Performance', () => {
    it('should execute plugins efficiently', () => {
      const plugin = createRequestIdPlugin();
      const startTime = Date.now();

      for (let i = 0; i < 1000; i++) {
        const ctx = createMockContext();
        // Initialize plugin context
        ctx.state['__plugins'] = new Map();
        plugin.preRoute?.(ctx);
      }

      const duration = Date.now() - startTime;

      // Should complete 1000 executions in less than 100ms
      expect(duration).toBeLessThan(100);
    });
  });
});
