import { describe, it, expect } from 'vitest';
import { formatPrometheus } from '../../src/observability/prometheus-format.js';
import { Gateway } from '../../src/index.js';
import { Router } from '../../src/core/router.js';

describe('formatPrometheus', () => {
  it('formats basic metrics snapshot into Prometheus text 0.0.4', () => {
    const snapshot = {
      totalRequests: 100,
      totalErrors: 5,
      authFailures: 2,
      requestsPerSecond: 10.5,
      avgLatency: 12.3,
      p50Latency: 10,
      p95Latency: 25,
      p99Latency: 50,
      activeConnections: 3,
      memoryUsage: {
        heapUsed: 1024 * 1024 * 50,
        heapTotal: 1024 * 1024 * 100,
        rss: 1024 * 1024 * 150,
        external: 1024 * 1024 * 2,
        arrayBuffers: 1024 * 1024 * 1,
      },
      cpuUsage: {
        user: 100000,
        system: 50000,
      },
      timestamp: 1700000000000,
    };

    const output = formatPrometheus(snapshot);
    expect(output).toContain('# HELP gateway_requests_total Total requests processed\n# TYPE gateway_requests_total counter\ngateway_requests_total 100');
    expect(output).toContain('# HELP gateway_errors_total Total errors\n# TYPE gateway_errors_total counter\ngateway_errors_total 5');
    expect(output).toContain('# HELP gateway_auth_failures_total Total auth failures\n# TYPE gateway_auth_failures_total counter\ngateway_auth_failures_total 2');
    expect(output).toContain('# HELP gateway_active_connections Active connections\n# TYPE gateway_active_connections gauge\ngateway_active_connections 3');
    expect(output).toContain('# HELP gateway_requests_per_second Requests per second\n# TYPE gateway_requests_per_second gauge\ngateway_requests_per_second 10.5');
    expect(output).toContain('# HELP gateway_latency_avg_milliseconds Average latency in milliseconds\n# TYPE gateway_latency_avg_milliseconds gauge\ngateway_latency_avg_milliseconds 12.3');
    expect(output).toContain('# HELP gateway_memory_heap_used_bytes Memory heap used in bytes\n# TYPE gateway_memory_heap_used_bytes gauge\ngateway_memory_heap_used_bytes 52428800');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('formats histogram buckets, counts, sums, and quantiles', () => {
    const snapshot = {
      totalRequests: 10,
      totalErrors: 0,
      authFailures: 0,
      requestsPerSecond: 1,
      avgLatency: 5,
      p50Latency: 5,
      p95Latency: 8,
      p99Latency: 9,
      activeConnections: 0,
      memoryUsage: { heapUsed: 0, heapTotal: 0, rss: 0, external: 0, arrayBuffers: 0 },
      cpuUsage: { user: 0, system: 0 },
      timestamp: 1700000000000,
      histograms: {
        http_request_duration_ms: {
          count: 10,
          sum: 50,
          buckets: {
            '5': 4,
            '10': 9,
            '+Inf': 10,
          },
        },
      },
    };

    const output = formatPrometheus(snapshot);
    expect(output).toContain('# TYPE http_request_duration_ms histogram');
    expect(output).toContain('http_request_duration_ms_bucket{le="5"} 4');
    expect(output).toContain('http_request_duration_ms_bucket{le="10"} 9');
    expect(output).toContain('http_request_duration_ms_bucket{le="+Inf"} 10');
    expect(output).toContain('http_request_duration_ms_sum 50');
    expect(output).toContain('http_request_duration_ms_count 10');
  });

  it('escapes label values correctly (backslash, double-quote, newline)', () => {
    const snapshot = {
      totalRequests: 1,
      totalErrors: 0,
      authFailures: 0,
      requestsPerSecond: 1,
      avgLatency: 1,
      p50Latency: 1,
      p95Latency: 1,
      p99Latency: 1,
      activeConnections: 0,
      memoryUsage: { heapUsed: 0, heapTotal: 0, rss: 0, external: 0, arrayBuffers: 0 },
      cpuUsage: { user: 0, system: 0 },
      timestamp: 1700000000000,
      counters: {
        test_counter: {
          value: 1,
          labels: {
            path: 'a\\b"c\nd',
          },
        },
      },
    };

    const output = formatPrometheus(snapshot);
    expect(output).toContain('test_counter{path="a\\\\b\\"c\\nd"} 1');
  });

  it('formats custom gauges and counters from snapshot records', () => {
    const snapshot = {
      totalRequests: 0,
      totalErrors: 0,
      authFailures: 0,
      requestsPerSecond: 0,
      avgLatency: 0,
      p50Latency: 0,
      p95Latency: 0,
      p99Latency: 0,
      activeConnections: 0,
      memoryUsage: { heapUsed: 0, heapTotal: 0, rss: 0, external: 0, arrayBuffers: 0 },
      cpuUsage: { user: 0, system: 0 },
      timestamp: 1700000000000,
      gauges: {
        queue_size: 42,
      },
      counters: {
        items_processed: 100,
      },
    };

    const output = formatPrometheus(snapshot);
    expect(output).toContain('# TYPE queue_size gauge\nqueue_size 42');
    expect(output).toContain('# TYPE items_processed counter\nitems_processed 100');
  });

  it('formats advanced route and upstream metrics when present', () => {
    const snapshot = {
      totalRequests: 10,
      totalErrors: 0,
      authFailures: 0,
      requestsPerSecond: 1,
      avgLatency: 5,
      p50Latency: 5,
      p95Latency: 5,
      p99Latency: 5,
      activeConnections: 1,
      memoryUsage: { heapUsed: 0, heapTotal: 0, rss: 0, external: 0, arrayBuffers: 0 },
      cpuUsage: { user: 0, system: 0 },
      timestamp: 1700000000000,
      advanced: {
        routes: [
          {
            route: '/api/v1',
            requestCount: 8,
            errorCount: 1,
            avgLatency: 15,
            statusCodes: new Map([[200, 7], [500, 1]]),
          },
        ],
        upstreams: [
          {
            upstreamId: 'srv-1',
            requestCount: 8,
            errorCount: 1,
            successCount: 7,
            avgLatency: 14,
          },
        ],
      },
    };

    const output = formatPrometheus(snapshot);
    expect(output).toContain('gateway_route_requests_total{route="/api/v1"} 8');
    expect(output).toContain('gateway_route_errors_total{route="/api/v1"} 1');
    expect(output).toContain('gateway_route_latency_avg_milliseconds{route="/api/v1"} 15');
    expect(output).toContain('gateway_route_status_codes_total{route="/api/v1",code="200"} 7');
    expect(output).toContain('gateway_route_status_codes_total{route="/api/v1",code="500"} 1');
    expect(output).toContain('gateway_upstream_requests_total{upstream_id="srv-1"} 8');
    expect(output).toContain('gateway_upstream_success_total{upstream_id="srv-1"} 7');
  });

  it('falls back to JSON when neither Accept text/plain nor ?format=prometheus requested', () => {
    const gateway = new Gateway('fake-config-path');
    (gateway as unknown as { registerSystemRoutes: () => void }).registerSystemRoutes();

    const router = (gateway as unknown as { router: Router }).router;
    const match = router.match('GET', '/metrics');
    expect(match).toBeDefined();
    expect(match?.handler).toBeDefined();

    let writtenStatus = 0;
    let writtenHeaders: Record<string, string> = {};
    let writtenBody = '';

    const mockCtxJson = {
      headers: { accept: 'application/json' },
      query: {},
      res: {
        writeHead: (status: number, headers: Record<string, string>) => {
          writtenStatus = status;
          writtenHeaders = headers;
        },
        end: (body: string) => {
          writtenBody = body;
        },
      },
      responded: false,
    };

    match!.handler(mockCtxJson as unknown as import('../../src/types/core.js').RequestContext);
    expect(writtenStatus).toBe(200);
    expect(writtenHeaders['Content-Type']).toBe('application/json');
    expect(() => JSON.parse(writtenBody)).not.toThrow();

    const mockCtxPromAccept = {
      headers: { accept: 'text/plain; q=0.9, text/html' },
      query: {},
      res: {
        writeHead: (status: number, headers: Record<string, string>) => {
          writtenStatus = status;
          writtenHeaders = headers;
        },
        end: (body: string) => {
          writtenBody = body;
        },
      },
      responded: false,
    };

    match!.handler(mockCtxPromAccept as unknown as import('../../src/types/core.js').RequestContext);
    expect(writtenStatus).toBe(200);
    expect(writtenHeaders['Content-Type']).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(writtenBody).toContain('# TYPE gateway_requests_total counter');

    const mockCtxPromQuery = {
      headers: {},
      query: { format: 'prometheus' },
      res: {
        writeHead: (status: number, headers: Record<string, string>) => {
          writtenStatus = status;
          writtenHeaders = headers;
        },
        end: (body: string) => {
          writtenBody = body;
        },
      },
      responded: false,
    };

    match!.handler(mockCtxPromQuery as unknown as import('../../src/types/core.js').RequestContext);
    expect(writtenStatus).toBe(200);
    expect(writtenHeaders['Content-Type']).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(writtenBody).toContain('# TYPE gateway_requests_total counter');
  });
});
