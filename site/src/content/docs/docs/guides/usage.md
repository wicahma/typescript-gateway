---
title: "Usage Guide"
description: "Practical recipes: proxying, auth, rate limiting, caching, load balancing, and custom plugins."
---

At the end of this guide, you will have working recipes for authentication, rate limits, caching, and load balancing in your gateway.

## Recipes Overview

The following recipes represent standard production deployment patterns:

| Recipe | Feature Area | Config Section |
| --- | --- | --- |
| Basic Proxy | Routing | `routes`, `upstreams` |
| JWT Authentication | Identity | `auth` |
| API Keys & Quotas | Traffic Control | `apiKeys` |
| Response Caching | Performance | `responseCache` |
| Credential Injection | Security | `upstreamCredentials` |
| Load Balancing | Traffic Control | `upstreams[].weight` |

## Step 1: Set Up Reverse Proxy

Configure a basic proxy that forwards requests from `/api/*` to an upstream service while providing local health checks:

```json
{
  "server": { "port": 8088, "host": "0.0.0.0" },
  "routes": [
    { "method": "GET", "path": "/api/:id", "priority": 0 },
    { "method": "POST", "path": "/api/orders", "priority": 0 }
  ],
  "upstreams": [
    {
      "id": "backend",
      "protocol": "http",
      "host": "127.0.0.1",
      "port": 8080,
      "basePath": "",
      "poolSize": 10,
      "timeout": 30000,
      "healthCheck": {
        "enabled": true,
        "path": "/health",
        "interval": 30000,
        "timeout": 5000,
        "expectedStatus": 200
      }
    }
  ]
}
```

Start the gateway and verify routing:

```bash
npx tsgate start
```

Expected output:

```text
Gateway started on http://0.0.0.0:8088
```

Verify the health check endpoint:

```bash
curl -s http://localhost:8088/health
```

Expected output:

```json
{"status":"healthy","upstreams":[{"id":"backend","status":"healthy"}]}
```

## Step 2: Add Authentication and Rate Limiting

Secure upstream services by requiring JWT validation or API keys with client-specific rate limits.

### JWT Authentication Recipe

Add the `auth` block to verify tokens using native cryptographic keys:

```json
{
  "auth": {
    "enabled": true,
    "issuer": "https://id.example.com",
    "audience": "my-api",
    "leewaySeconds": 30,
    "publicRoutes": ["/health", "/metrics", "/auth/login"],
    "jwks": {
      "keys": [
        { "kty": "RSA", "n": "...", "e": "AQAB", "kid": "2026-01" }
      ]
    }
  }
}
```

Verify authentication enforcement:

```bash
curl -i http://localhost:8088/api/profile
```

Expected output:

```text
HTTP/1.1 401 Unauthorized
content-type: application/problem+json

{"type":"about:blank","title":"Unauthorized","status":401,"detail":"Missing or invalid token"}
```

### API Key Quotas Recipe

Add consumer-specific rate limits with `apiKeys`:

```json
{
  "apiKeys": {
    "enabled": true,
    "headerName": "x-api-key",
    "cacheTtlSeconds": 60,
    "cacheMaxEntries": 1000,
    "publicRoutes": ["/health"],
    "consumers": [
      {
        "consumerId": "mobile-app",
        "plan": "free",
        "rateLimit": 100,
        "keys": [{ "key": "ak_live_mobile_123" }]
      }
    ]
  }
}
```

## Step 3: Enable Caching and Upstream Signing

Improve latency with in-memory caching and securely sign outbound requests.

### Response Caching Recipe

Add the `responseCache` configuration block:

```json
{
  "responseCache": {
    "enabled": true,
    "ttlSeconds": 60,
    "maxSize": 5000
  }
}
```

Verify cache status:

```bash
curl -i http://localhost:8088/api/items
```

Expected output:

```text
HTTP/1.1 200 OK
x-cache: MISS
```

Sending the same request immediately returns:

```text
HTTP/1.1 200 OK
x-cache: HIT
```

### Credential Injection and HMAC Recipe

Attach internal service credentials and HMAC signatures:

```json
{
  "upstreamCredentials": {
    "enabled": true,
    "credentials": [
      {
        "name": "billing-service",
        "headers": { "x-internal-token": "secret-token" },
        "hmac": {
          "secret": "${BILLING_HMAC_SECRET}",
          "keyId": "gw-1",
          "headerNamespace": "x-hmac"
        }
      }
    ],
    "injection": { "credentialName": "billing-service", "publicRoutes": ["/health"] },
    "signing": { "credentialName": "billing-service", "publicRoutes": ["/health"] }
  }
}
```

## Step 4: Configure Load Balancing

Distribute traffic across multiple backends using weighted upstream endpoints:

```json
{
  "upstreams": [
    {
      "id": "api-primary",
      "host": "10.0.0.1",
      "port": 8080,
      "weight": 3,
      "healthCheck": { "enabled": true, "path": "/health" }
    },
    {
      "id": "api-secondary",
      "host": "10.0.0.2",
      "port": 8080,
      "weight": 1,
      "healthCheck": { "enabled": true, "path": "/health" }
    }
  ]
}
```

The gateway balances traffic at a 3:1 ratio and bypasses instances that fail background health checks.

## Next Steps

To examine the internal mechanics of circuit breaking, radix routing, and pipeline policies, explore [Deep Dive](/docs/deep-dive/).
