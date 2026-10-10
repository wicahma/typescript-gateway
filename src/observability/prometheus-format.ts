function escapeLabelValue(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function formatLabels(labels?: Record<string, string>): string {
  if (!labels) return '';
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  const pairs = entries.map(([k, v]) => `${k}="${escapeLabelValue(String(v))}"`);
  return `{${pairs.join(',')}}`;
}

interface HistogramBucketData {
  count?: number;
  sum?: number;
  buckets?: Record<string, number>;
  labels?: Record<string, string>;
  help?: string;
}

interface MetricValueWithLabels {
  value: number;
  labels?: Record<string, string>;
  help?: string;
}

export function formatPrometheus(snapshot: Record<string, unknown>): string {
  const lines: string[] = [];

  const addMetric = (
    name: string,
    type: 'counter' | 'gauge' | 'histogram',
    help: string,
    value: number,
    labels?: Record<string, string>
  ): void => {
    if (help) {
      lines.push(`# HELP ${name} ${help}`);
    }
    lines.push(`# TYPE ${name} ${type}`);
    lines.push(`${name}${formatLabels(labels)} ${value}`);
  };

  if (typeof snapshot['totalRequests'] === 'number') {
    addMetric('gateway_requests_total', 'counter', 'Total requests processed', snapshot['totalRequests']);
  }
  if (typeof snapshot['totalErrors'] === 'number') {
    addMetric('gateway_errors_total', 'counter', 'Total errors', snapshot['totalErrors']);
  }
  if (typeof snapshot['authFailures'] === 'number') {
    addMetric('gateway_auth_failures_total', 'counter', 'Total auth failures', snapshot['authFailures']);
  }
  if (typeof snapshot['activeConnections'] === 'number') {
    addMetric('gateway_active_connections', 'gauge', 'Active connections', snapshot['activeConnections']);
  }
  if (typeof snapshot['requestsPerSecond'] === 'number') {
    addMetric('gateway_requests_per_second', 'gauge', 'Requests per second', snapshot['requestsPerSecond']);
  }
  if (typeof snapshot['avgLatency'] === 'number') {
    addMetric('gateway_latency_avg_milliseconds', 'gauge', 'Average latency in milliseconds', snapshot['avgLatency']);
  }
  if (typeof snapshot['p50Latency'] === 'number') {
    addMetric('gateway_latency_p50_milliseconds', 'gauge', 'P50 latency in milliseconds', snapshot['p50Latency']);
  }
  if (typeof snapshot['p95Latency'] === 'number') {
    addMetric('gateway_latency_p95_milliseconds', 'gauge', 'P95 latency in milliseconds', snapshot['p95Latency']);
  }
  if (typeof snapshot['p99Latency'] === 'number') {
    addMetric('gateway_latency_p99_milliseconds', 'gauge', 'P99 latency in milliseconds', snapshot['p99Latency']);
  }

  const mem = snapshot['memoryUsage'] as NodeJS.MemoryUsage | undefined;
  if (mem && typeof mem === 'object') {
    if (typeof mem.heapUsed === 'number') {
      addMetric('gateway_memory_heap_used_bytes', 'gauge', 'Memory heap used in bytes', mem.heapUsed);
    }
    if (typeof mem.heapTotal === 'number') {
      addMetric('gateway_memory_heap_total_bytes', 'gauge', 'Memory heap total in bytes', mem.heapTotal);
    }
    if (typeof mem.rss === 'number') {
      addMetric('gateway_memory_rss_bytes', 'gauge', 'Resident set size in bytes', mem.rss);
    }
    if (typeof mem.external === 'number') {
      addMetric('gateway_memory_external_bytes', 'gauge', 'Memory external in bytes', mem.external);
    }
    if (typeof mem.arrayBuffers === 'number') {
      addMetric('gateway_memory_array_buffers_bytes', 'gauge', 'Memory array buffers in bytes', mem.arrayBuffers);
    }
  }

  const cpu = snapshot['cpuUsage'] as NodeJS.CpuUsage | undefined;
  if (cpu && typeof cpu === 'object') {
    if (typeof cpu.user === 'number') {
      addMetric('gateway_cpu_user_microseconds', 'counter', 'CPU user time in microseconds', cpu.user);
    }
    if (typeof cpu.system === 'number') {
      addMetric('gateway_cpu_system_microseconds', 'counter', 'CPU system time in microseconds', cpu.system);
    }
  }

  const customCounters = snapshot['counters'] as Record<string, unknown> | undefined;
  if (customCounters && typeof customCounters === 'object') {
    for (const [name, val] of Object.entries(customCounters)) {
      if (typeof val === 'number') {
        lines.push(`# TYPE ${name} counter`);
        lines.push(`${name} ${val}`);
      } else if (val && typeof val === 'object') {
        const item = val as MetricValueWithLabels;
        if (typeof item.value === 'number') {
          if (item.help) {
            lines.push(`# HELP ${name} ${item.help}`);
          }
          lines.push(`# TYPE ${name} counter`);
          lines.push(`${name}${formatLabels(item.labels)} ${item.value}`);
        }
      }
    }
  }

  const customGauges = snapshot['gauges'] as Record<string, unknown> | undefined;
  if (customGauges && typeof customGauges === 'object') {
    for (const [name, val] of Object.entries(customGauges)) {
      if (typeof val === 'number') {
        lines.push(`# TYPE ${name} gauge`);
        lines.push(`${name} ${val}`);
      } else if (val && typeof val === 'object') {
        const item = val as MetricValueWithLabels;
        if (typeof item.value === 'number') {
          if (item.help) {
            lines.push(`# HELP ${name} ${item.help}`);
          }
          lines.push(`# TYPE ${name} gauge`);
          lines.push(`${name}${formatLabels(item.labels)} ${item.value}`);
        }
      }
    }
  }

  const histograms = snapshot['histograms'] as Record<string, unknown> | undefined;
  if (histograms && typeof histograms === 'object') {
    for (const [name, val] of Object.entries(histograms)) {
      if (val && typeof val === 'object') {
        const h = val as HistogramBucketData;
        if (h.help) {
          lines.push(`# HELP ${name} ${h.help}`);
        }
        lines.push(`# TYPE ${name} histogram`);
        if (h.buckets && typeof h.buckets === 'object') {
          for (const [le, count] of Object.entries(h.buckets)) {
            const labels = { ...(h.labels ?? {}), le };
            lines.push(`${name}_bucket${formatLabels(labels)} ${count}`);
          }
        }
        if (typeof h.sum === 'number') {
          lines.push(`${name}_sum${formatLabels(h.labels)} ${h.sum}`);
        }
        if (typeof h.count === 'number') {
          lines.push(`${name}_count${formatLabels(h.labels)} ${h.count}`);
        }
      }
    }
  }

  const advanced = snapshot['advanced'] as Record<string, unknown> | undefined;
  if (advanced && typeof advanced === 'object') {
    const routes = advanced['routes'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(routes) && routes.length > 0) {
      lines.push('# HELP gateway_route_requests_total Route request count');
      lines.push('# TYPE gateway_route_requests_total counter');
      for (const r of routes) {
        const route = String(r['route'] ?? '');
        const count = Number(r['requestCount'] ?? 0);
        lines.push(`gateway_route_requests_total${formatLabels({ route })} ${count}`);
      }

      lines.push('# HELP gateway_route_errors_total Route error count');
      lines.push('# TYPE gateway_route_errors_total counter');
      for (const r of routes) {
        const route = String(r['route'] ?? '');
        const count = Number(r['errorCount'] ?? 0);
        lines.push(`gateway_route_errors_total${formatLabels({ route })} ${count}`);
      }

      lines.push('# HELP gateway_route_latency_avg_milliseconds Route average latency in milliseconds');
      lines.push('# TYPE gateway_route_latency_avg_milliseconds gauge');
      for (const r of routes) {
        const route = String(r['route'] ?? '');
        const avg = Number(r['avgLatency'] ?? 0);
        lines.push(`gateway_route_latency_avg_milliseconds${formatLabels({ route })} ${avg}`);
      }

      const hasStatusCodes = routes.some(r => r['statusCodes'] instanceof Map || (r['statusCodes'] && typeof r['statusCodes'] === 'object'));
      if (hasStatusCodes) {
        lines.push('# HELP gateway_route_status_codes_total Route status code distribution');
        lines.push('# TYPE gateway_route_status_codes_total counter');
        for (const r of routes) {
          const route = String(r['route'] ?? '');
          const statusCodes = r['statusCodes'];
          if (statusCodes instanceof Map) {
            for (const [code, count] of statusCodes.entries()) {
              lines.push(`gateway_route_status_codes_total${formatLabels({ route, code: String(code) })} ${count}`);
            }
          } else if (statusCodes && typeof statusCodes === 'object') {
            for (const [code, count] of Object.entries(statusCodes)) {
              lines.push(`gateway_route_status_codes_total${formatLabels({ route, code: String(code) })} ${count}`);
            }
          }
        }
      }
    }

    const upstreams = advanced['upstreams'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(upstreams) && upstreams.length > 0) {
      lines.push('# HELP gateway_upstream_requests_total Upstream request count');
      lines.push('# TYPE gateway_upstream_requests_total counter');
      for (const u of upstreams) {
        const upstream_id = String(u['upstreamId'] ?? '');
        const count = Number(u['requestCount'] ?? 0);
        lines.push(`gateway_upstream_requests_total${formatLabels({ upstream_id })} ${count}`);
      }

      lines.push('# HELP gateway_upstream_errors_total Upstream error count');
      lines.push('# TYPE gateway_upstream_errors_total counter');
      for (const u of upstreams) {
        const upstream_id = String(u['upstreamId'] ?? '');
        const count = Number(u['errorCount'] ?? 0);
        lines.push(`gateway_upstream_errors_total${formatLabels({ upstream_id })} ${count}`);
      }

      lines.push('# HELP gateway_upstream_success_total Upstream success count');
      lines.push('# TYPE gateway_upstream_success_total counter');
      for (const u of upstreams) {
        const upstream_id = String(u['upstreamId'] ?? '');
        const count = Number(u['successCount'] ?? 0);
        lines.push(`gateway_upstream_success_total${formatLabels({ upstream_id })} ${count}`);
      }

      lines.push('# HELP gateway_upstream_latency_avg_milliseconds Upstream average latency in milliseconds');
      lines.push('# TYPE gateway_upstream_latency_avg_milliseconds gauge');
      for (const u of upstreams) {
        const upstream_id = String(u['upstreamId'] ?? '');
        const avg = Number(u['avgLatency'] ?? 0);
        lines.push(`gateway_upstream_latency_avg_milliseconds${formatLabels({ upstream_id })} ${avg}`);
      }
    }
  }

  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}
