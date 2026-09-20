---
title: "Getting Started"
description: "How to install, configure, build, and run the TypeScript Service Gateway with zero runtime dependencies."
order: 1
section: "Guide"
---

# Getting Started

TypeScript Service Gateway is an ultra-low-latency HTTP reverse proxy and API gateway with **zero runtime dependencies** (`dependencies: {}`). Everything executes on Node.js native primitives (`node:http`, `node:zlib`, `node:crypto`).

## Prerequisites

- **Node.js**: `v20.x` or `v22.x` LTS
- **Package Manager**: `npm`, `pnpm`, or `bun`
- **TypeScript**: `^6.0.3` (dev only)

## Installation

Clone the repository and install development dependencies (compiler, linter, test runner):

```bash
git clone https://github.com/wicahma/typescript-gateway.git
cd typescript-gateway
npm install
```

## Running the Gateway

### 1. Development Mode (Hot Execution via tsx)

```bash
PORT=8088 npm run dev
```

*Note: Default port in `config/gateway.config.json` is `3000`. If port 3000 is occupied by homelab or CI services, override it via the `PORT` environment variable.*

### 2. Production Mode

The repository includes a `prestart` lifecycle hook that automatically builds TypeScript before starting Node:

```bash
PORT=8088 npm start
```

Manual compile and start:

```bash
npm run build
PORT=8088 node dist/index.js
```

### 3. Custom Configuration Path

```bash
PORT=8080 CONFIG_PATH=./config/production.json npm start
```

## Built-in System Endpoints

The gateway reserves three core routes that are handled in-memory without upstream forwarding:

### Health Check (`GET /health`)
```bash
curl -i http://localhost:8088/health
```
```json
{
  "status": "ok",
  "uptime": 14.82
}
```

### Metrics Snapshot (`GET /metrics`)
```bash
curl -i http://localhost:8088/metrics
```
Returns latency histograms (P50, P90, P99), active connections, upstream status, and error counts.

### Root Identifier (`GET /`)
```bash
curl -i http://localhost:8088/
```
Returns plaintext: `TypeScript Service Gateway`.

## Running the Test Suite

```bash
# Run full suite (37 files, 732 tests)
npm test

# Unit tests only
npm run test:unit

# Typecheck without emit
npm run typecheck

# Code quality check
npm run lint
```
