/**
 * Tests for plugin execution chain
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PluginExecutionChain } from '../../src/plugins/execution-chain.js';
import { Plugin, PluginHook } from '../../src/types/plugin.js';
import { RequestContext, HttpMethod } from '../../src/types/core.js';
import { IncomingMessage, ServerResponse } from 'http';

// Mock plugin for testing
class MockPlugin implements Plugin {
  name: string;
  version = '1.0.0';
  description = 'Mock plugin for testing';
  
  preRouteCalled = false;
  preHandlerCalled = false;
  postHandlerCalled = false;
  postResponseCalled = false;
  onErrorCalled = false;
  
  constructor(name: string) {
    this.name = name;
  }
  
  preRoute(): void {
    this.preRouteCalled = true;
  }
  
  preHandler(): void {
    this.preHandlerCalled = true;
  }
  
  postHandler(): void {
    this.postHandlerCalled = true;
  }
  
  postResponse(): void {
    this.postResponseCalled = true;
  }
  
  onError(): void {
    this.onErrorCalled = true;
  }
  
  reset(): void {
    this.preRouteCalled = false;
    this.preHandlerCalled = false;
    this.postHandlerCalled = false;
    this.postResponseCalled = false;
    this.onErrorCalled = false;
  }
}

// Plugin that throws error
class ErrorPlugin implements Plugin {
  name = 'error-plugin';
  version = '1.0.0';
  description = 'Plugin that throws error';
  
  preRoute(): void {
    throw new Error('Test error');
  }
}

// Plugin that times out
class TimeoutPlugin implements Plugin {
  name = 'timeout-plugin';
  version = '1.0.0';
  description = 'Plugin that times out';
  
  async preRoute(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10000)); // 10 seconds
  }
}

// Plugin that short-circuits
class ShortCircuitPlugin implements Plugin {
  name = 'short-circuit-plugin';
  version = '1.0.0';
  description = 'Plugin that short-circuits';
  
  preRoute(ctx: RequestContext): void {
    ctx.responded = true;
  }
}

// Helper to create mock context
function createMockContext(): RequestContext {
  return {
    requestId: 'test-req-1',
    startTime: process.hrtime.bigint(),
    method: 'GET' as HttpMethod,
    path: '/test',
    query: null,
    params: {},
    headers: {},
    body: null,
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
    upstream: null,
    state: {},
    responded: false,
    route: null,
    timestamps: {},
  };
}

describe('PluginExecutionChain', () => {
  let chain: PluginExecutionChain;
  
  beforeEach(() => {
    chain = new PluginExecutionChain({
      timeout: 1000,
      collectMetrics: true,
      enableCaching: false,
      shortCircuitOnError: false,
    });
  });

  describe('Plugin registration', () => {
    it('should register plugin', () => {
      const plugin = new MockPlugin('test');
      chain.register(plugin);
      
      expect(chain.hasPlugin('test')).toBe(true);
      expect(chain.getPluginCount()).toBe(1);
    });

    it('should register multiple plugins with order', () => {
      const plugin1 = new MockPlugin('plugin1');
      const plugin2 = new MockPlugin('plugin2');
      
      chain.register(plugin1, {}, { order: 1 });
      chain.register(plugin2, {}, { order: 0 });
      
      expect(chain.getPluginCount()).toBe(2);
    });

    it('should get plugin names', () => {
      const plugin1 = new MockPlugin('plugin1');
      const plugin2 = new MockPlugin('plugin2');
      
      chain.register(plugin1);
      chain.register(plugin2);
      
      const names = chain.getPluginNames();
      expect(names).toContain('plugin1');
      expect(names).toContain('plugin2');
    });
  });

  describe('Plugin execution', () => {
    it('should execute plugin hooks in order', async () => {
      const plugin = new MockPlugin('test');
      chain.register(plugin);
      await chain.initializeAll();
      
      const ctx = createMockContext();
      
      await chain.executeHook(PluginHook.PRE_ROUTE, ctx);
      expect(plugin.preRouteCalled).toBe(true);
      
      await chain.executeHook(PluginHook.PRE_HANDLER, ctx);
      expect(plugin.preHandlerCalled).toBe(true);
      
      await chain.executeHook(PluginHook.POST_HANDLER, ctx);
      expect(plugin.postHandlerCalled).toBe(true);
      
      await chain.executeHook(PluginHook.POST_RESPONSE, ctx);
      expect(plugin.postResponseCalled).toBe(true);
    });

    it('should execute multiple plugins in order', async () => {
      const plugin1 = new MockPlugin('plugin1');
      const plugin2 = new MockPlugin('plugin2');
      
      chain.register(plugin1, {}, { order: 0 });
      chain.register(plugin2, {}, { order: 1 });
      await chain.initializeAll();
      
      const ctx = createMockContext();
      
      const results = await chain.executeHook(PluginHook.PRE_ROUTE, ctx);
      
      expect(plugin1.preRouteCalled).toBe(true);
      expect(plugin2.preRouteCalled).toBe(true);
      expect(results).toHaveLength(2);
    });

    it('should handle plugin errors gracefully', async () => {
      const errorPlugin = new ErrorPlugin();
      const normalPlugin = new MockPlugin('normal');
      
      chain.register(errorPlugin, {}, { order: 0 });
      chain.register(normalPlugin, {}, { order: 1 });
      await chain.initializeAll();
      
      const ctx = createMockContext();
      
      const results = await chain.executeHook(PluginHook.PRE_ROUTE, ctx);
      
      // Error plugin should fail
      expect(results[0]?.success).toBe(false);
      expect(results[0]?.error).toBeDefined();
      
      // Normal plugin should still execute
      expect(normalPlugin.preRouteCalled).toBe(true);
      expect(results[1]?.success).toBe(true);
    });

    it('should handle plugin timeouts', async () => {
      const timeoutPlugin = new TimeoutPlugin();
      
      const shortTimeoutChain = new PluginExecutionChain({
        timeout: 100, // 100ms timeout
        collectMetrics: true,
      });
      
      shortTimeoutChain.register(timeoutPlugin);
      await shortTimeoutChain.initializeAll();
      
      const ctx = createMockContext();
      
      const results = await shortTimeoutChain.executeHook(PluginHook.PRE_ROUTE, ctx);
      
      expect(results[0]?.success).toBe(false);
      expect(results[0]?.timedOut).toBe(true);
      expect(results[0]?.error?.message).toContain('timed out');
      
      await shortTimeoutChain.destroyAll();
    });

    it('should short-circuit when plugin sets responded', async () => {
      const shortCircuitPlugin = new ShortCircuitPlugin();
      const laterPlugin = new MockPlugin('later');
      
      chain.register(shortCircuitPlugin, {}, { order: 0 });
      chain.register(laterPlugin, {}, { order: 1 });
      await chain.initializeAll();
      
      const ctx = createMockContext();
      
      const results = await chain.executeHook(PluginHook.PRE_ROUTE, ctx);
      
      expect(results[0]?.success).toBe(true);
      expect(results[1]?.shortCircuited).toBe(true);
      expect(laterPlugin.preRouteCalled).toBe(false);
    });

    it('should execute onError hook when error occurs', async () => {
      const plugin = new MockPlugin('test');
      chain.register(plugin);
      await chain.initializeAll();
      
      const ctx = createMockContext();
      const testError = new Error('Test error');
      
      await chain.executeHook(PluginHook.ON_ERROR, ctx, testError);
      
      expect(plugin.onErrorCalled).toBe(true);
    });
  });

  describe('Plugin enable/disable', () => {
    it('should disable plugin', async () => {
      const plugin = new MockPlugin('test');
      chain.register(plugin);
      await chain.initializeAll();
      
      chain.disable('test');
      
      const ctx = createMockContext();
      await chain.executeHook(PluginHook.PRE_ROUTE, ctx);
      
      expect(plugin.preRouteCalled).toBe(false);
    });

    it('should enable disabled plugin', async () => {
      const plugin = new MockPlugin('test');
      chain.register(plugin);
      await chain.initializeAll();
      
      chain.disable('test');
      chain.enable('test');
      
      const ctx = createMockContext();
      await chain.executeHook(PluginHook.PRE_ROUTE, ctx);
      
      expect(plugin.preRouteCalled).toBe(true);
    });
  });

  describe('Plugin initialization and cleanup', () => {
    it('should initialize all plugins', async () => {
      const initPlugin: Plugin = {
        name: 'init-test',
        version: '1.0.0',
        description: 'Test init',
        initCalled: false,
        init() {
          this.initCalled = true;
        },
        initCalled: false,
      };
      
      chain.register(initPlugin);
      await chain.initializeAll();
      
      expect(initPlugin.initCalled).toBe(true);
    });

    it('should destroy all plugins', async () => {
      const destroyPlugin: Plugin = {
        name: 'destroy-test',
        version: '1.0.0',
        description: 'Test destroy',
        destroyCalled: false,
        destroy() {
          this.destroyCalled = true;
        },
        destroyCalled: false,
      };
      
      chain.register(destroyPlugin);
      await chain.initializeAll();
      await chain.destroyAll();
      
      expect(destroyPlugin.destroyCalled).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should execute plugins efficiently', async () => {
      const plugin = new MockPlugin('test');
      chain.register(plugin);
      await chain.initializeAll();
      
      const ctx = createMockContext();
      
      const startTime = Date.now();
      
      // Execute hook multiple times
      for (let i = 0; i < 1000; i++) {
        plugin.reset();
        await chain.executeHook(PluginHook.PRE_ROUTE, ctx);
      }
      
      const duration = Date.now() - startTime;
      
      // Should complete 1000 executions in less than 200ms
      expect(duration).toBeLessThan(200);
    });

    it('should track execution metrics', async () => {
      const plugin = new MockPlugin('test');
      chain.register(plugin);
      await chain.initializeAll();
      
      const ctx = createMockContext();
      
      const results = await chain.executeHook(PluginHook.PRE_ROUTE, ctx);
      
      expect(results[0]?.duration).toBeGreaterThanOrEqual(0);
      expect(results[0]?.success).toBe(true);
    });
  });

  describe('Context initialization', () => {
    it('should initialize plugin context', async () => {
      const plugin = new MockPlugin('test');
      chain.register(plugin);
      await chain.initializeAll();
      
      const ctx = createMockContext();
      
      await chain.executeHook(PluginHook.PRE_ROUTE, ctx);
      
      // Plugin context should be initialized
      expect(ctx.state['__plugins']).toBeDefined();
    });
  });
});
