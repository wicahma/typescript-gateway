/**
 * Performance dashboard with real-time metrics
 * Phase 9: Real-time performance monitoring dashboard
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { EventEmitter } from 'events';

/**
 * Time range for historical queries
 */
export interface TimeRange {
  from: number;
  to: number;
}

/**
 * Historical metrics data
 */
export interface HistoricalMetrics {
  timeRange: TimeRange;
  metrics: MetricPoint[];
  aggregates: MetricAggregates;
}

/**
 * Single metric point
 */
export interface MetricPoint {
  timestamp: number;
  latency: {
    p50: number;
    p95: number;
    p99: number;
  };
  throughput: number;
  errorRate: number;
  memoryUsage: number;
}

/**
 * Metric aggregates
 */
export interface MetricAggregates {
  avgLatencyP99: number;
  maxLatencyP99: number;
  avgThroughput: number;
  totalRequests: number;
  totalErrors: number;
}

/**
 * Worker metrics
 */
export interface WorkerMetrics {
  workerId: number;
  pid: number;
  uptime: number;
  requestsHandled: number;
  cpu: number;
  memory: number;
  latency: {
    p50: number;
    p95: number;
    p99: number;
  };
}

/**
 * Route metrics
 */
export interface RouteMetrics {
  path: string;
  method: string;
  count: number;
  avgLatency: number;
  p99Latency: number;
  errorRate: number;
}

/**
 * Upstream metrics
 */
export interface UpstreamMetrics {
  id: string;
  url: string;
  healthy: boolean;
  requestCount: number;
  avgLatency: number;
  errorRate: number;
}

/**
 * Performance alert
 */
export interface PerformanceAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: number;
  metric: string;
  value: number;
  threshold: number;
}

/**
 * Event stream for SSE
 */
export class EventStream extends EventEmitter {
  private clients: ServerResponse[] = [];

  addClient(res: ServerResponse): void {
    this.clients.push(res);

    res.on('close', () => {
      const index = this.clients.indexOf(res);
      if (index > -1) {
        this.clients.splice(index, 1);
      }
    });
  }

  broadcast(event: string, data: any): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

    for (const client of this.clients) {
      if (!client.destroyed) {
        client.write(message);
      }
    }
  }

  getClientCount(): number {
    return this.clients.filter(c => !c.destroyed).length;
  }
}

/**
 * Performance Dashboard
 */
export class PerformanceDashboard {
  private server: ReturnType<typeof createServer> | null = null;
  private eventStream: EventStream;
  private metricsHistory: MetricPoint[] = [];
  private workerMetrics: Map<number, WorkerMetrics> = new Map();
  private routeMetrics: Map<string, RouteMetrics> = new Map();
  private upstreamMetrics: Map<string, UpstreamMetrics> = new Map();
  private alerts: PerformanceAlert[] = [];
  private updateInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.eventStream = new EventStream();
  }

  /**
   * Start dashboard server
   */
  async start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', reject);

      this.server.listen(port, () => {
        console.log(`Performance dashboard started on port ${port}`);
        this.startMetricsUpdate();
        resolve();
      });
    });
  }

  /**
   * Stop dashboard server
   */
  async stop(): Promise<void> {
    this.stopMetricsUpdate();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle HTTP requests
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || '/';

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Route requests
    if (url === '/api/performance/realtime') {
      this.handleRealTime(req, res);
    } else if (url.startsWith('/api/performance/history')) {
      this.handleHistory(req, res);
    } else if (url === '/api/performance/workers') {
      this.handleWorkers(req, res);
    } else if (url === '/api/performance/routes') {
      this.handleRoutes(req, res);
    } else if (url === '/api/performance/upstreams') {
      this.handleUpstreams(req, res);
    } else if (url === '/api/performance/alerts') {
      this.handleAlerts(req, res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }

  /**
   * Handle real-time SSE stream
   */
  private handleRealTime(_req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    this.eventStream.addClient(res);
  }

  /**
   * Handle historical metrics query
   */
  private handleHistory(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || '', `http://${req.headers['host']}`);
    const from = parseInt(url.searchParams.get('from') || '0');
    const to = parseInt(url.searchParams.get('to') || String(Date.now()));

    const historical = this.getHistoricalMetrics({ from, to });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(historical));
  }

  /**
   * Handle worker metrics query
   */
  private handleWorkers(_req: IncomingMessage, res: ServerResponse): void {
    const workers = this.getWorkerMetrics();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(workers));
  }

  /**
   * Handle route metrics query
   */
  private handleRoutes(_req: IncomingMessage, res: ServerResponse): void {
    const routes = Array.from(this.routeMetrics.values());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(routes));
  }

  /**
   * Handle upstream metrics query
   */
  private handleUpstreams(_req: IncomingMessage, res: ServerResponse): void {
    const upstreams = Array.from(this.upstreamMetrics.values());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(upstreams));
  }

  /**
   * Handle alerts query
   */
  private handleAlerts(_req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(this.alerts));
  }

  /**
   * Get real-time metrics stream
   */
  getRealTimeMetrics(): EventStream {
    return this.eventStream;
  }

  /**
   * Get historical metrics
   */
  getHistoricalMetrics(timeRange: TimeRange): HistoricalMetrics {
    const filtered = this.metricsHistory.filter(
      (m) => m.timestamp >= timeRange.from && m.timestamp <= timeRange.to
    );

    const aggregates: MetricAggregates = {
      avgLatencyP99: 0,
      maxLatencyP99: 0,
      avgThroughput: 0,
      totalRequests: 0,
      totalErrors: 0,
    };

    if (filtered.length > 0) {
      aggregates.avgLatencyP99 =
        filtered.reduce((sum, m) => sum + m.latency.p99, 0) / filtered.length;
      aggregates.maxLatencyP99 = Math.max(...filtered.map((m) => m.latency.p99));
      aggregates.avgThroughput =
        filtered.reduce((sum, m) => sum + m.throughput, 0) / filtered.length;
      aggregates.totalRequests = filtered.reduce((sum, m) => sum + m.throughput, 0);
    }

    return {
      timeRange,
      metrics: filtered,
      aggregates,
    };
  }

  /**
   * Get worker metrics
   */
  getWorkerMetrics(): WorkerMetrics[] {
    return Array.from(this.workerMetrics.values());
  }

  /**
   * Update metrics (called periodically)
   */
  updateMetrics(point: MetricPoint): void {
    this.metricsHistory.push(point);

    // Keep last 1 hour of metrics (at 1 second intervals = 3600 points)
    if (this.metricsHistory.length > 3600) {
      this.metricsHistory.shift();
    }

    // Broadcast to connected clients
    this.eventStream.broadcast('metrics', point);
  }

  /**
   * Update worker metrics
   */
  updateWorkerMetric(workerId: number, metrics: WorkerMetrics): void {
    this.workerMetrics.set(workerId, metrics);
    this.eventStream.broadcast('worker', metrics);
  }

  /**
   * Update route metrics
   */
  updateRouteMetric(routeKey: string, metrics: RouteMetrics): void {
    this.routeMetrics.set(routeKey, metrics);
  }

  /**
   * Update upstream metrics
   */
  updateUpstreamMetric(upstreamId: string, metrics: UpstreamMetrics): void {
    this.upstreamMetrics.set(upstreamId, metrics);
  }

  /**
   * Add alert
   */
  addAlert(alert: PerformanceAlert): void {
    this.alerts.push(alert);

    // Keep last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts.shift();
    }

    this.eventStream.broadcast('alert', alert);
  }

  /**
   * Start periodic metrics update
   */
  private startMetricsUpdate(): void {
    this.updateInterval = setInterval(() => {
      // Generate sample metrics
      const point: MetricPoint = {
        timestamp: Date.now(),
        latency: {
          p50: Math.random() * 2,
          p95: Math.random() * 5,
          p99: Math.random() * 10,
        },
        throughput: 10000 + Math.random() * 5000,
        errorRate: Math.random() * 0.01,
        memoryUsage: process.memoryUsage().heapUsed,
      };

      this.updateMetrics(point);
    }, 1000);
  }

  /**
   * Stop periodic metrics update
   */
  private stopMetricsUpdate(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Get connected client count
   */
  getConnectedClients(): number {
    return this.eventStream.getClientCount();
  }
}
