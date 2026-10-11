---
title: "Getting Started"
description: "From zero to a running gateway in about two minutes. No framework knowledge needed."
---

At the end of this guide, you will have a running gateway that forwards HTTP requests to a local service with custom headers.

## Prerequisites

Ensure your development environment meets the following requirements before starting:

| Requirement | Supported Version | Verification Command |
| --- | --- | --- |
| Node.js | 20.0.0 or higher | `node -v` |
| npm | 9.0.0 or higher | `npm -v` |
| HTTP Service | Any local HTTP backend | `python3 -m http.server 3000` |

## Step 1: Install and Initialize

Create a new directory for your gateway project, initialize package settings, and scaffold gateway files:

```bash
mkdir my-gateway && cd my-gateway
npm init -y
npm install typescript-gateway tsx
npx tsgate init .
```

Expected output:

```text
Created gateway project in /path/to/my-gateway
  - package.json
  - gateway.config.json
  - plugins/hello.ts
  - AGENTS.md
  - CLAUDE.md
```

The scaffolding creates `gateway.config.json` for routing definitions and `plugins/hello.ts` for lifecycle hooks.

It also writes `AGENTS.md` and `CLAUDE.md` for AI coding agents. The rules live in a managed `<!-- BEGIN:tsgate-agent-rules -->` block that points the agent at the version-matched docs bundled at `node_modules/typescript-gateway/dist/docs/index.md`. `tsgate start` re-upserts the block; text you add outside it is preserved.

## Step 2: Configure Route and Upstream

Open `gateway.config.json` and review the default routing configuration:

```json
{
  "server": {
    "port": 8088
  },
  "routes": [
    {
      "method": "GET",
      "path": "/api/*"
    }
  ],
  "upstreams": [
    {
      "id": "backend",
      "host": "localhost",
      "port": 3000
    }
  ]
}
```

The configuration defines the following parameters:

| Field | Setting | Purpose |
| --- | --- | --- |
| `server.port` | `8088` | Port where the gateway listens for incoming requests. |
| `routes[0].path` | `/api/*` | Matches any GET request starting with `/api/`. |
| `upstreams[0]` | `localhost:3000` | Address of the target HTTP service. |

Validate the configuration file:

```bash
npx tsgate validate
```

Expected output:

```text
OK: configuration is valid (1 routes, 1 upstreams)
```

## Step 3: Start and Verify Gateway

Start a local HTTP upstream in a separate terminal:

```bash
python3 -m http.server 3000
```

Expected output:

```text
Serving HTTP on 0.0.0.0 port 3000 (http://0.0.0.0:3000/) ...
```

In your project directory, start the gateway process:

```bash
npx tsgate start
```

Expected output:

```text
Gateway started on http://0.0.0.0:8088
```

Send a test request through the proxy:

```bash
curl -i http://localhost:8088/api/
```

Expected output:

```text
HTTP/1.1 200 OK
x-hello: from tsgate plugin
Content-Type: text/html
Content-Length: ...
```

The request succeeds and includes the `x-hello` response header set by `plugins/hello.ts`.

## Next Steps

To learn how to tune timeouts, add environment variables, and configure multiple routes, read [Configuration](/docs/guides/configuration/).
