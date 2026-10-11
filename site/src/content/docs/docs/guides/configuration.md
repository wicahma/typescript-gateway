---
title: "Configuration Reference"
description: "Declarative JSON configuration with environment variable interpolation."
---

At the end of this guide, you will have a validated gateway.config.json file tailored for your production or local environment.

## Overview

The gateway reads its settings from a declarative JSON file (`gateway.config.json`). Every string field supports environment variable interpolation with fallback defaults.

| Top-Level Section | Purpose | Required |
| --- | --- | --- |
| `server` | HTTP listener, port, timeouts, and body limits. | Yes |
| `routes` | Inbound URL patterns, HTTP methods, and priorities. | Yes |
| `upstreams` | Destination services, connection pools, and health checks. | Yes |
| `performance` | Worker count and memory pool allocations. | No |

## Step 1: Create Base Configuration File

Create `gateway.config.json` in your project root:

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

## Step 2: Configure Core Options

Adjust the primary settings based on your network architecture:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `server.port` | number | `3000` | Port for incoming HTTP requests. |
| `server.keepAlive` | boolean | `true` | Reuses TCP connections between client and gateway. |
| `server.maxBodySize` | number | `10485760` | Maximum request payload size in bytes (10 MB). |
| `routes[].path` | string | — | Route pattern, supporting `:param` tokens. |
| `upstreams[].poolSize` | number | `10` | Maximum socket pool connections per upstream. |

## Step 3: Interpolate Environment Variables

Replace static strings with environment variables where needed. Use `${VAR_NAME}` or fallback syntax `${VAR_NAME:-defaultValue}`:

```json
{
  "server": {
    "host": "${GATEWAY_HOST:-0.0.0.0}",
    "port": "${GATEWAY_PORT:-3000}"
  },
  "upstreams": [
    {
      "id": "backend-service",
      "host": "${BACKEND_HOST:-localhost}",
      "port": "${BACKEND_PORT:-8080}"
    }
  ]
}
```

The gateway substitutes variables before parsing and validating the JSON schema.

## Step 4: Validate Configuration File

Run the configuration validator from your project directory:

```bash
npx tsgate validate
```

Expected output:

```text
OK: configuration is valid (1 routes, 1 upstreams)
```

If an error is present, the validator reports the exact JSON pointer and expected schema type:

```bash
GATEWAY_PORT=abc npx tsgate validate
```

Expected output:

```text
Error: server.port must be an integer, received NaN
```

## Next Steps

To set up authentication, rate limiting, and response caching for your routes, proceed to [Usage](/docs/guides/usage/).
