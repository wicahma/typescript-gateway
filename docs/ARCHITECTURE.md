# Architecture Overview

## High-Level Design

The TypeScript Gateway is designed with performance as the primary goal. The architecture follows a master-worker pattern with the following key components:

### 1. Core Components

#### Server (`src/core/server.ts`)
- Wraps Node.js native `http` module
- Implements zero-copy request/response handling
- Manages connection lifecycle and keep-alive
- Uses object pooling for request contexts
- Handles backpressure and socket pooling

#### Router (`src/core/router.ts`)
- Radix tree (trie) based routing for O(log n) lookup
- Static routes use Map for O(1) lookup
- Supports:
  - Static routes: `/users/list`
  - Dynamic routes: `/users/:id`
  - Wildcard routes: `/api/*`
- Pre-compiled route patterns for performance
- Parameter extraction with zero-copy

#### Worker (`src/core/worker.ts`)
- Handles requests in dedicated thread
- Isolates request processing from master process
- Receives configuration updates via message passing
- Reports metrics back to master

#### Orchestrator (`src/core/orchestrator.ts`)
- Master process that spawns worker threads
- Distributes load across workers
- Aggregates metrics from all workers
- Manages worker lifecycle (spawn, monitor, restart)
- Handles configuration updates

### 2. Configuration System

#### Schema (`src/config/schema.ts`)
- JSON Schema validation using AJV
- Type-safe configuration
- Validates at startup
- Supports:
  - Server settings
  - Route definitions
  - Upstream configurations
  - Plugin settings
  - Performance tuning

#### Loader (`src/config/loader.ts`)
- Loads configuration from JSON files
- Supports hot reload
- Watches for file changes
- Emits events on configuration changes
- Merges with defaults

#### Validator (`src/config/validator.ts`)
- Fast JSON schema validation
- Pre-compiled schemas for performance
- Detailed error reporting
- Type assertions for TypeScript

### 3. Plugin System

#### Loader (`src/plugins/loader.ts`)
- Dynamically loads plugins from directory
- Validates plugin structure
- Manages plugin lifecycle
- Supports enable/disable
- Hot reload capable

#### Executor (`src/plugins/executor.ts`)
- Executes plugin hooks in order
- Handles errors gracefully
- Tracks execution statistics
- Supports hooks:
  - init: Plugin initialization
  - preRoute: Before routing
  - preHandler: After routing, before handler
  - postHandler: After handler
  - postResponse: After response sent
  - onError: Error handling
  - destroy: Cleanup

#### Hooks (`src/plugins/hooks.ts`)
- Defines standard lifecycle hooks
- Hook metadata and ordering
- Request lifecycle integration

### 4. Performance Utilities

#### Object Pool (`src/utils/pool.ts`)
- Generic object pooling for any type
- Fixed-size pools with overflow handling
- Lock-free access patterns
- Tracks pool statistics
- Special BufferPool for byte buffers
- Minimizes GC pressure

#### Metrics (`src/utils/metrics.ts`)
- Lock-free metrics collection
- Circular buffer for latency histogram
- Calculates percentiles (P50, P95, P99)
- Tracks:
  - Total requests
  - Errors
  - RPS (requests per second)
  - Latency distribution
  - Active connections
  - Memory/CPU usage

#### Logger (`src/utils/logger.ts`)
- High-performance structured logging
- Uses Pino for async logging
- Minimal overhead
- Pretty printing for development
- JSON output for production

### 5. Type System

#### Core Types (`src/types/core.ts`)
- RequestContext: Pooled request context
- Route: Route definition
- UpstreamTarget: Backend service config
- MetricsSnapshot: Performance metrics
- WorkerMessage: Master-worker protocol
- All types designed for zero-copy

#### Plugin Types (`src/types/plugin.ts`)
- Plugin interface
- Hook definitions
- Execution context
- Statistics tracking

#### Config Types (`src/types/config.ts`)
- Configuration structures
- Validation results
- Loader options
- Change events

## Data Flow

### Request Processing

```
1. Connection → Server (native HTTP)
2. Acquire RequestContext from pool
3. Parse request (zero-copy)
4. Execute plugin preRoute hooks
5. Match route (O(log n) or O(1))
6. Extract route parameters
7. Execute plugin preHandler hooks
8. Execute route handler
9. Execute plugin postHandler hooks
10. Send response
11. Execute plugin postResponse hooks
12. Release RequestContext to pool
13. Record metrics
```

### Worker Communication

```
Master Process
  ↓
  ├─ Spawn Workers
  ├─ Send CONFIG_UPDATE
  ├─ Request METRICS
  └─ Aggregate results

Worker Process
  ↑
  ├─ Receive messages
  ├─ Handle requests
  ├─ Send METRICS_RESPONSE
  └─ Process CONFIG_UPDATE
```

## Performance Optimizations

### 1. Zero Framework
- No Express, Fastify, or Koa
- Direct use of Node.js `http` module
- Eliminates middleware overhead

### 2. Object Pooling
- Request contexts pooled
- Buffers pooled
- Reduces GC pressure
- Improves allocation performance

### 3. Monomorphic Code
- Consistent function signatures
- Helps V8 optimize hot paths
- Predictable types

### 4. Pre-computation
- Routes compiled at startup
- Schemas pre-compiled
- Plugins loaded once

### 5. Lock-free Operations
- Metrics use atomic counters
- Circular buffers for histograms
- Minimize contention

### 6. Zero-copy Patterns
- Direct buffer references
- No unnecessary string copies
- Lazy parsing (query params)

## Testing Strategy

### Unit Tests
- Router matching logic
- Object pool operations
- Configuration validation
- Isolated component testing

### Integration Tests
- End-to-end request flow
- Plugin integration
- Worker communication
- Configuration loading

### Performance Tests
- Load testing with autocannon
- Latency measurements
- Throughput benchmarks
- Memory profiling

## Future Enhancements (Phase 2+)

1. **Request Handling**
   - Body parsing
   - Streaming responses
   - WebSocket support

2. **Upstream Integration**
   - HTTP client pool
   - Load balancing
   - Circuit breakers
   - Health checks

3. **Advanced Features**
   - Rate limiting
   - Authentication
   - Caching
   - Compression

4. **Observability**
   - Distributed tracing
   - Prometheus metrics
   - Dashboard
   - Alerting
