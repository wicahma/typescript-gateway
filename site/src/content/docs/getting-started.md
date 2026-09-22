---
title: "Getting Started"
description: "From zero to a running gateway in about two minutes. No framework knowledge needed."
order: 1
section: "Guide"
track: "guide"
---

# Getting Started

TypeScript Gateway is a reverse proxy and API gateway written in pure
TypeScript on top of Node's built-in `node:http`. There is no framework
underneath — install it, write one JSON file, and you have a gateway.

## What you'll need

- **Node.js 20 or newer** — check with `node -v`
- A backend to proxy to (any HTTP service; for trying things out,
  `python3 -m http.server 3000` works fine)

That's the whole list.

## Install

```bash
npm install -g typescript-gateway
```

Or straight from GitHub while the npm name settles:

```bash
npm install -g github:wicahma/typescript-gateway
```

## Create your first gateway

```bash
mkdir my-gateway && cd my-gateway
tsgate init
```

`init` scaffolds three things:

```
my-gateway/
├── package.json
├── gateway.config.json   ← routes, upstreams, plugins
└── plugins/
    └── hello.ts          ← an example plugin
```

Open `gateway.config.json` — the important part is tiny:

```json
{
  "server": { "port": 8088 },
  "routes": [{ "method": "GET", "path": "/api/*" }],
  "upstreams": [{ "id": "backend", "host": "localhost", "port": 3000 }]
}
```

Read it as: *"requests to `GET /api/**` go to the service on
`localhost:3000`"*. Everything else has sensible defaults.

## Run it

Start a throwaway backend first so you can see traffic flow:

```bash
python3 -m http.server 3000 &
```

Then start the gateway:

```bash
tsgate start
```

You should see `Gateway started` on port 8088. Try it:

```bash
curl http://localhost:8088/health
curl http://localhost:8088/api/test
```

The second request was proxied to your backend — and the response carries an
`x-hello: from tsgate plugin` header. That header came from
`plugins/hello.ts`, the example plugin that `init` created. You just ran a
gateway with a working plugin without writing any code.

## Your first plugin

Open `plugins/hello.ts`:

```ts
import type { Plugin } from 'typescript-gateway';

const plugin: Plugin = {
  name: 'hello',
  version: '1.0.0',
  description: 'Adds a response header',

  async postHandler(ctx) {
    ctx.state['pluginHeaders'] = { 'x-hello': 'from tsgate plugin' };
  },
};

export default plugin;
```

Every `.ts` file in `plugins/` is loaded at startup. Hooks available:
`preRoute`, `preHandler` (before the upstream call), `postHandler`,
`postResponse` (after), `onError`, plus `init` and `destroy` for setup and
teardown. To change response headers, put them in `ctx.state.pluginHeaders` —
they get merged into the final response.

> **Note:** setting headers directly on `ctx.res` in `postHandler` won't
> survive — the proxy writes upstream headers after your hook runs. Use
> `ctx.state.pluginHeaders` instead.

## Check your config without starting

```bash
tsgate validate
```

Prints `OK: ... (N routes, M upstreams)` or tells you exactly what's wrong.

## Where to go next

- **Recipes** — real-world setups: auth, rate limiting, caching, load
  balancing. See [Usage Guide](/docs/usage).
- **Configuration** — every option in `gateway.config.json`, explained. See
  [Configuration](/docs/configuration).
- **How it works** — the request lifecycle, from socket to upstream and back.
  See [Architecture](/docs/architecture).
- **Deep dives** — the Reference section in the sidebar documents each
  subsystem in full detail.

## Embedding in your own app

The CLI is optional. The gateway is a library too:

```ts
import { Gateway } from 'typescript-gateway';

const gateway = new Gateway('./gateway.config.json');
await gateway.start();
```
