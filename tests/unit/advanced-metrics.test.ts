/**
 * Unit tests for Advanced Metrics
 * Phase 6: Proxy Logic & Request Forwarding
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AdvancedMetrics } from '../../src/core/advanced-metrics.js';

describe('AdvancedMetrics', () => {
  let metrics: AdvancedMetrics;

  beforeEach(() => {
    metrics = new AdvancedMetrics();
  });

  describe('Request Transformation Metrics', () => {
    it('should record request transformation', () => {
      metrics.recordRequestTransformation(0.3);
      metrics.recordRequestTransformation(0.5);
      metrics.recordRequestTransformation(0.4);

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.requestTransformations.count).toBe(3);
      expect(allMetrics.requestTransformations.avgDuration).toBeCloseTo(0.4, 1);
      expect(allMetrics.requestTransformations.minDuration).toBe(0.3);
      expect(allMetrics.requestTransformations.maxDuration).toBe(0.5);
    });

    it('should not record when disabled', () => {
      metrics.updateConfig({ collectTransformations: false });
      metrics.recordRequestTransformation(0.5);

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.requestTransformations.count).toBe(0);
    });
  });

  describe('Response Transformation Metrics', () => {
    it('should record response transformation', () => {
      metrics.recordResponseTransformation(0.2);
      metrics.recordResponseTransformation(0.4);

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.responseTransformations.count).toBe(2);
      expect(allMetrics.responseTransformations.avgDuration).toBeCloseTo(0.3, 1);
    });
  });

  describe('Compression Metrics', () => {
    it('should record compression', () => {
      metrics.recordCompression(1000, 400, 1.5);
      metrics.recordCompression(2000, 800, 1.8);

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.compression.count).toBe(2);
      expect(allMetrics.compression.totalOriginalSize).toBe(3000);
      expect(allMetrics.compression.totalCompressedSize).toBe(1200);
      expect(allMetrics.compression.avgRatio).toBeCloseTo(0.4, 1);
      expect(allMetrics.compression.avgDuration).toBeCloseTo(1.65, 1);
    });

    it('should record decompression', () => {
      metrics.recordDecompression(400, 1000, 0.8);
      metrics.recordDecompression(800, 2000, 1.2);

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.decompression.count).toBe(2);
      expect(allMetrics.decompression.avgDuration).toBeCloseTo(1.0, 1);
    });

    it('should not record when disabled', () => {
      metrics.updateConfig({ collectCompression: false });
      metrics.recordCompression(1000, 400, 1.0);

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.compression.count).toBe(0);
    });
  });

  describe('WebSocket Metrics', () => {
    it('should record WebSocket connection', () => {
      metrics.recordWebSocketConnection(true);
      metrics.recordWebSocketConnection(true);
      metrics.recordWebSocketConnection(true);

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.webSocket.activeConnections).toBe(3);
      expect(allMetrics.webSocket.totalConnections).toBe(3);
    });

    it('should decrement active connections', () => {
      metrics.recordWebSocketConnection(true);
      metrics.recordWebSocketConnection(true);
      metrics.recordWebSocketConnection(false);

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.webSocket.activeConnections).toBe(1);
      expect(allMetrics.webSocket.totalConnections).toBe(2);
    });

    it('should not go below zero active connections', () => {
      metrics.recordWebSocketConnection(false);
      metrics.recordWebSocketConnection(false);

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.webSocket.activeConnections).toBe(0);
    });

    it('should record WebSocket data transfer', () => {
      metrics.recordWebSocketTransfer(100, 200, 5, 10);
      metrics.recordWebSocketTransfer(150, 250, 8, 12);

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.webSocket.totalBytesSent).toBe(250);
      expect(allMetrics.webSocket.totalBytesReceived).toBe(450);
      expect(allMetrics.webSocket.totalMessagesSent).toBe(13);
      expect(allMetrics.webSocket.totalMessagesReceived).toBe(22);
    });

    it('should record WebSocket connection duration', () => {
      metrics.recordWebSocketConnection(true);
      metrics.recordWebSocketDuration(5000);
      
      metrics.recordWebSocketConnection(true);
      metrics.recordWebSocketDuration(3000);

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.webSocket.avgConnectionDuration).toBeCloseTo(4000, 0);
    });

    it('should not record when disabled', () => {
      metrics.updateConfig({ collectWebSocket: false });
      metrics.recordWebSocketConnection(true);

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.webSocket.activeConnections).toBe(0);
    });
  });

  describe('Route Metrics', () => {
    it('should record route metrics', () => {
      metrics.recordRouteMetrics('/api/users', 100, 500, 10, 200, false);
      metrics.recordRouteMetrics('/api/users', 150, 600, 12, 200, false);

      const routeMetrics = metrics.getRouteMetrics('/api/users');
      expect(routeMetrics).toHaveLength(1);
      expect(routeMetrics[0]!.requestCount).toBe(2);
      expect(routeMetrics[0]!.avgRequestSize).toBe(125);
      expect(routeMetrics[0]!.avgResponseSize).toBe(550);
      expect(routeMetrics[0]!.avgLatency).toBe(11);
      expect(routeMetrics[0]!.errorCount).toBe(0);
    });

    it('should record error count', () => {
      metrics.recordRouteMetrics('/api/users', 100, 500, 10, 200, false);
      metrics.recordRouteMetrics('/api/users', 100, 500, 10, 500, true);

      const routeMetrics = metrics.getRouteMetrics('/api/users');
      expect(routeMetrics[0]!.errorCount).toBe(1);
    });

    it('should track status code distribution', () => {
      metrics.recordRouteMetrics('/api/users', 100, 500, 10, 200, false);
      metrics.recordRouteMetrics('/api/users', 100, 500, 10, 200, false);
      metrics.recordRouteMetrics('/api/users', 100, 500, 10, 404, false);
      metrics.recordRouteMetrics('/api/users', 100, 500, 10, 500, true);

      const routeMetrics = metrics.getRouteMetrics('/api/users');
      const statusCodes = routeMetrics[0]!.statusCodes;
      
      expect(statusCodes.get(200)).toBe(2);
      expect(statusCodes.get(404)).toBe(1);
      expect(statusCodes.get(500)).toBe(1);
    });

    it('should track multiple routes separately', () => {
      metrics.recordRouteMetrics('/api/users', 100, 500, 10, 200, false);
      metrics.recordRouteMetrics('/api/posts', 200, 600, 15, 200, false);

      const allRoutes = metrics.getRouteMetrics();
      expect(allRoutes).toHaveLength(2);
    });

    it('should not record when disabled', () => {
      metrics.updateConfig({ collectPerRoute: false });
      metrics.recordRouteMetrics('/api/users', 100, 500, 10, 200, false);

      const routeMetrics = metrics.getRouteMetrics();
      expect(routeMetrics).toHaveLength(0);
    });
  });

  describe('Upstream Metrics', () => {
    it('should record upstream metrics', () => {
      metrics.recordUpstreamMetrics('backend-1', 10, 100, 500, false);
      metrics.recordUpstreamMetrics('backend-1', 12, 150, 600, false);

      const upstreamMetrics = metrics.getUpstreamMetrics('backend-1');
      expect(upstreamMetrics).toHaveLength(1);
      expect(upstreamMetrics[0]!.requestCount).toBe(2);
      expect(upstreamMetrics[0]!.avgLatency).toBe(11);
      expect(upstreamMetrics[0]!.totalBytesSent).toBe(250);
      expect(upstreamMetrics[0]!.totalBytesReceived).toBe(1100);
      expect(upstreamMetrics[0]!.successCount).toBe(2);
      expect(upstreamMetrics[0]!.errorCount).toBe(0);
    });

    it('should record errors', () => {
      metrics.recordUpstreamMetrics('backend-1', 10, 100, 500, false);
      metrics.recordUpstreamMetrics('backend-1', 12, 150, 600, true);

      const upstreamMetrics = metrics.getUpstreamMetrics('backend-1');
      expect(upstreamMetrics[0]!.successCount).toBe(1);
      expect(upstreamMetrics[0]!.errorCount).toBe(1);
    });

    it('should track multiple upstreams separately', () => {
      metrics.recordUpstreamMetrics('backend-1', 10, 100, 500, false);
      metrics.recordUpstreamMetrics('backend-2', 15, 150, 600, false);

      const allUpstreams = metrics.getUpstreamMetrics();
      expect(allUpstreams).toHaveLength(2);
    });

    it('should not record when disabled', () => {
      metrics.updateConfig({ collectPerUpstream: false });
      metrics.recordUpstreamMetrics('backend-1', 10, 100, 500, false);

      const upstreamMetrics = metrics.getUpstreamMetrics();
      expect(upstreamMetrics).toHaveLength(0);
    });
  });

  describe('Error Metrics', () => {
    it('should record client errors', () => {
      metrics.recordError('clientErrors');
      metrics.recordError('clientErrors');

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.errors.clientErrors).toBe(2);
    });

    it('should record server errors', () => {
      metrics.recordError('serverErrors');

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.errors.serverErrors).toBe(1);
    });

    it('should record network errors', () => {
      metrics.recordError('networkErrors');

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.errors.networkErrors).toBe(1);
    });

    it('should record timeout errors', () => {
      metrics.recordError('timeoutErrors');

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.errors.timeoutErrors).toBe(1);
    });

    it('should record circuit breaker errors', () => {
      metrics.recordError('circuitBreakerErrors');

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.errors.circuitBreakerErrors).toBe(1);
    });

    it('should record transformation errors', () => {
      metrics.recordError('transformationErrors');

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.errors.transformationErrors).toBe(1);
    });

    it('should record other errors', () => {
      metrics.recordError('otherErrors');

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.errors.otherErrors).toBe(1);
    });
  });

  describe('Error Categorization', () => {
    it('should categorize 4xx as client errors', () => {
      const category = metrics.categorizeError(400);
      expect(category).toBe('clientErrors');
    });

    it('should categorize 5xx as server errors', () => {
      const category = metrics.categorizeError(500);
      expect(category).toBe('serverErrors');
    });

    it('should categorize timeout by error type', () => {
      const category = metrics.categorizeError(undefined, 'Request timeout');
      expect(category).toBe('timeoutErrors');
    });

    it('should categorize network errors by error type', () => {
      const category = metrics.categorizeError(undefined, 'network error');
      expect(category).toBe('networkErrors');
    });

    it('should categorize ECONNREFUSED as network error', () => {
      const category = metrics.categorizeError(undefined, 'ECONNREFUSED');
      expect(category).toBe('networkErrors');
    });

    it('should categorize circuit breaker errors by error type', () => {
      const category = metrics.categorizeError(undefined, 'circuit breaker open');
      expect(category).toBe('circuitBreakerErrors');
    });

    it('should categorize transformation errors by error type', () => {
      const category = metrics.categorizeError(undefined, 'transform failed');
      expect(category).toBe('transformationErrors');
    });

    it('should categorize unknown errors as other', () => {
      const category = metrics.categorizeError(undefined, 'unknown error');
      expect(category).toBe('otherErrors');
    });
  });

  describe('Configuration', () => {
    it('should update configuration', () => {
      metrics.updateConfig({
        collectPerRoute: false,
        collectPerUpstream: false,
      });

      metrics.recordRouteMetrics('/api/users', 100, 500, 10, 200, false);
      metrics.recordUpstreamMetrics('backend-1', 10, 100, 500, false);

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.routes).toHaveLength(0);
      expect(allMetrics.upstreams).toHaveLength(0);
    });

    it('should disable all metrics when disabled', () => {
      metrics.updateConfig({ enabled: false });

      metrics.recordRequestTransformation(0.5);
      metrics.recordResponseTransformation(0.5);
      metrics.recordCompression(1000, 400, 1.0);
      metrics.recordWebSocketConnection(true);
      metrics.recordRouteMetrics('/api/users', 100, 500, 10, 200, false);
      metrics.recordUpstreamMetrics('backend-1', 10, 100, 500, false);
      metrics.recordError('clientErrors');

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.requestTransformations.count).toBe(0);
      expect(allMetrics.responseTransformations.count).toBe(0);
      expect(allMetrics.compression.count).toBe(0);
      expect(allMetrics.webSocket.activeConnections).toBe(0);
      expect(allMetrics.routes).toHaveLength(0);
      expect(allMetrics.upstreams).toHaveLength(0);
      expect(allMetrics.errors.clientErrors).toBe(0);
    });
  });

  describe('Reset', () => {
    it('should reset all metrics', () => {
      metrics.recordRequestTransformation(0.5);
      metrics.recordResponseTransformation(0.5);
      metrics.recordCompression(1000, 400, 1.0);
      metrics.recordWebSocketConnection(true);
      metrics.recordRouteMetrics('/api/users', 100, 500, 10, 200, false);
      metrics.recordUpstreamMetrics('backend-1', 10, 100, 500, false);
      metrics.recordError('clientErrors');

      metrics.reset();

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.requestTransformations.count).toBe(0);
      expect(allMetrics.responseTransformations.count).toBe(0);
      expect(allMetrics.compression.count).toBe(0);
      expect(allMetrics.webSocket.activeConnections).toBe(0);
      expect(allMetrics.routes).toHaveLength(0);
      expect(allMetrics.upstreams).toHaveLength(0);
      expect(allMetrics.errors.clientErrors).toBe(0);
    });
  });

  describe('Performance', () => {
    it('should handle high volume of metrics efficiently', () => {
      const start = Date.now();

      for (let i = 0; i < 10000; i++) {
        metrics.recordRequestTransformation(0.5);
        metrics.recordRouteMetrics(`/api/route-${i % 100}`, 100, 500, 10, 200, false);
      }

      const duration = Date.now() - start;
      
      // Should complete in reasonable time (< 100ms for 10k metrics)
      expect(duration).toBeLessThan(100);

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.requestTransformations.count).toBe(10000);
      expect(allMetrics.routes).toHaveLength(100);
    });
  });
});
