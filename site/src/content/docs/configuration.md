---
title: "Configuration Reference"
description: "Declarative JSON configuration with environment variable interpolation."
order: 3
section: "Configuration"
track: "guide"
---

# Configuration Reference

The gateway is configured via a declarative JSON file (default: `config/gateway.config.json`). Every string field supports environment variable interpolation.

## Example Configuration

```json
{
  "version": "1.0.0",
  "environment": "production",
  "server": {
    "port": 3000,
    "host": "0.0.0.0",
    "keepAlive": true,
    "keepAliveTimeout": 65000,
    "requestTimeout": 30000,
    "maxHeaderSize": 16384,
    "maxBodySize": 10485760
  },
  "routes": [
    {
      "method": "GET",
      "path": "/api/:id",
      "priority": 0
    }
  ],
  "upstreams": [
    {
      "id": "backend-service",
      "protocol": "http",
      "host": "localhost",
      "port": 8080,
      "basePath": "",
      "poolSize": 10,
      "timeout": 30000,
      "healthCheck": {
        "enabled": true,
        "interval": 30000,
        "timeout": 5000,
        "path": "/health",
        "expectedStatus": 200
      }
    }
  ],
  "performance": {
    "workerCount": 0,
    "contextPoolSize": 1000,
    "bufferPoolSize": 1000,
    "responsePoolSize": 1000,
    "enablePooling": true
  }
}
```

## Environment Variable Interpolation

You can inject system environment variables directly into strings using `${VAR_NAME}` or fallback syntax `${VAR_NAME:-defaultValue}`:

```json
{
  "server": {
    "host": "${GATEWAY_HOST:-0.0.0.0}",
    "port": "${GATEWAY_PORT:-3000}"
  },
  "upstreams": [
    {
      "host": "${AUTH_SERVICE_HOST:-auth.internal}",
      "port": "${AUTH_SERVICE_PORT:-8080}"
    }
  ]
}
```

## Configuration Sections

### `server`
- `port`: Port number (overridden by `process.env.PORT` if present).
- `host`: Interface bind address (overridden by `process.env.HOST`).
- `keepAlive`: Enable HTTP Keep-Alive connection reuse.
- `keepAliveTimeout`: Timeout (in ms) before closing idle socket.
- `maxBodySize`: Maximum allowed request payload in bytes (default: 10MB).

### `routes`
- `method`: HTTP Verb (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`).
- `path`: URL pattern. Supports dynamic parameters (`/api/:id`).
- `priority`: Order of evaluation.

### `upstreams`
- `id`: Unique backend cluster key.
- `protocol`: `http` or `https`.
- `host`: Backend IP or hostname.
- `port`: Backend destination port.
- `poolSize`: Maximum persistent connections to maintain.
- `healthCheck`: Active background health probe configuration.

### `performance`
- `contextPoolSize`: Pre-allocated request context instances.
- `enablePooling`: Toggle memory pool recycling on/off.
