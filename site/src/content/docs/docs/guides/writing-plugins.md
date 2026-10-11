---
title: "Writing a Gateway Plugin"
description: "Comprehensive guide to authoring custom TypeScript Gateway plugins for request/response transformation, security checks, and policy enforcement."
---

Writing a custom plugin for **TypeScript Gateway (`tsgate`)** lets you intercept, modify, inspect, or short-circuit HTTP requests and responses at runtime — with zero third-party runtime dependencies.

Plugins are plain TypeScript modules loaded from disk at startup. They receive the live `RequestContext` for each request and hook into the gateway request pipeline at six defined lifecycle points.

## Plugin Lifecycle & Architecture

A plugin implements the `Plugin` interface from `src/types/plugin.ts`. Every hook is optional; implement only the ones you need.

| Hook | When it runs | Typical use |
| --- | --- | --- |
| `init(config)` | Once at plugin load | Read settings, build lookup tables |
| `preRoute(ctx)` | Before route matching | Set correlation IDs, reject early |
| `preHandler(ctx)` | After route match, before upstream | Inject headers, auth, rate limits |
| `postHandler(ctx)` | After upstream response, before client | Rewrite response headers |
| `postResponse(ctx)` | After the response is sent | Metrics, logging, cleanup |
| `onError(ctx, error)` | On an unhandled error | Error reporting, fallback headers |
| `destroy()` | On gateway shutdown | Flush buffers, close handles |

Each hook returns `void` or `Promise<void>`. Async hooks are awaited in order unless the plugin declares them in `asyncHooks`.

---

## 1. The `RequestContext` Object

Every hook receives the same mutable `RequestContext`. This is the object you work with — there is no separate `ctx.request` or `ctx.response` wrapper.

| Field | Type | Notes |
| --- | --- | --- |
| `requestId` | `string` | Correlation ID; assign in `preRoute` |
| `method` | `HttpMethod` | Uppercase verb |
| `path` | `string` | Path only, query already stripped |
| `query` | `Record<string, string> \| null` | Lazily parsed |
| `params` | `Record<string, string>` | Populated after route match |
| `headers` | `Record<string, string \| string[] \| undefined>` | Direct reference to `req.headers` — mutating it mutates the request |
| `body` | `Buffer \| null` | Raw request body |
| `req` | `IncomingMessage` | The raw Node request |
| `res` | `ServerResponse` | The raw Node response |
| `upstream` | `UpstreamTarget \| null` | Resolved upstream target |
| `state` | `Record<string, unknown>` | Plain object for per-request plugin data |
| `responded` | `boolean` | Set `true` to short-circuit |
| `route` | `RouteMatch \| null` | Matched route info |
| `timestamps` | `object` | Pipeline phase timestamps in nanoseconds |

Two important differences from many gateway APIs:

- **`ctx.headers` is the request header map directly.** There is no `ctx.request.headers`.
- **`ctx.state` is a plain object**, not a Map with `set`/`get` methods. Use `ctx.state['myKey'] = value`.

For response headers use the Node API on `ctx.res`: `ctx.res.setHeader(name, value)`.

---

## 2. Writing Your First Plugin

Create a file in the `plugins/` directory **next to your gateway config file** (see §3 for how the directory is resolved):

```typescript
import { PluginHook } from 'typescript-gateway';
import type { Plugin, RequestContext } from 'typescript-gateway';

export interface MyPluginConfig {
  headerName?: string;
  prefix?: string;
}

export class MyPlugin implements Plugin {
  name = 'my-plugin';
  version = '1.0.0';
  description = 'Injects a tracing header and reports handler duration';

  asyncHooks: PluginHook[] = [PluginHook.POST_RESPONSE];

  private headerName = 'X-Gateway-Custom';
  private prefix = 'processed';

  init(config: Record<string, unknown>): void {
    if (typeof config['headerName'] === 'string') this.headerName = config['headerName'];
    if (typeof config['prefix'] === 'string') this.prefix = config['prefix'];
  }

  preRoute(ctx: RequestContext): void {
    const incoming = ctx.headers['x-request-id'];
    const requestId = Array.isArray(incoming) ? incoming[0] : (incoming ?? 'unknown');
    ctx.res.setHeader(this.headerName, `${this.prefix}-${requestId}`);
    ctx.state['customStartTime'] = Date.now();
  }

  postHandler(ctx: RequestContext): void {
    const start = ctx.state['customStartTime'] as number | undefined;
    if (start !== undefined) {
      ctx.res.setHeader('x-plugin-duration-ms', String(Date.now() - start));
    }
  }

  postResponse(ctx: RequestContext): void {
    // runs off the request path: safe for logging and metrics
  }
}

export default new MyPlugin();
```

The loader accepts either a **default export** or the **module itself** as the plugin object (`module.default || module`). The object must expose string `name`, `version`, and `description` properties or the loader rejects it with `Invalid plugin: missing required properties`.

### Sharing data between plugins

`ctx.state` is shared, so namespace your keys and read them back with a cast:

```typescript
ctx.state['my-plugin:requestId'] = requestId;
const mine = ctx.state['my-plugin:requestId'] as string;

ctx.state['shared:responseTime'] = durationMs;
const shared = ctx.state['shared:responseTime'] as number;
```

The internal `pluginContextManager` (`src/plugins/context-manager.ts`) offers the same namespacing with `set`/`get`/`setShared`/`getShared`, but it is not part of the package's public export map — only import it if you are working inside the repository.

---

## 3. Registering the Plugin

Custom plugins are **loaded from a directory**, not from the `plugins` array in your config. At startup the CLI resolves the plugin directory as `plugins/` relative to the config file's own directory:

```
my-gateway/
├── gateway.config.json      <- config passed to `tsgate start -c`
└── plugins/
    ├── my-plugin.ts         <- loaded automatically
    └── audit-log.js
```

Every `.ts` and `.js` file in that directory is imported and registered. A plugin that fails to load is logged and skipped — the rest still start.

TypeScript plugins require `tsx` to be installed, since the CLI registers a `tsx` ESM loader before importing them:

```bash
npm install tsx
```

If `.ts` files are present and `tsx` is missing, the gateway exits with:

```
TypeScript plugins found in <dir> but tsx is not installed. Run: npm install tsx
```

Then start the gateway:

```bash
tsgate start -c gateway.config.json
```

### The config `plugins` array is for built-ins only

The `plugins` array in your config file only accepts the **built-in** plugin registry:

```json
{
  "plugins": [
    { "name": "request-id", "enabled": true, "settings": { "prefix": "req-" } }
  ]
}
```

Valid names are `auth-jwt`, `header-transformer`, `rate-limit`, `request-id`, `request-logger`, and `response-time`. Any other name logs `Unknown builtin plugin in config.plugins[] — ignoring`. To configure a custom plugin, read its settings from the `init(config)` argument, or keep the values in your own module.

---

## 4. High-Performance Plugin Best Practices

- **Declare `asyncHooks` for non-mutating hooks.** Hooks listed in `asyncHooks` are dispatched as microtasks and are *not* awaited before the gateway continues. Only list hooks that never mutate the request or response flow — logging, metrics, cleanup. Mutating hooks must stay synchronous.
- **Do no allocation in `preRoute` and `preHandler`.** These run on every request, before the upstream socket hop. Reuse objects, avoid spread on `ctx.state`, and skip string building you don't need.
- **Short-circuit instead of throwing.** Set `ctx.responded = true` after writing your response to stop the pipeline cleanly; throwing routes through `onError` and the generic error path.
- **Guard response writes.** Once the response has been sent, `ctx.res.setHeader()` throws. Check `ctx.responded` or use `postResponse`, which runs after the response is flushed.
- **Error isolation is automatic.** The execution chain wraps every plugin call in a try/catch boundary, so a throwing plugin cannot crash the worker. It does not make a plugin free — the wrapper still costs time on the hot path.
- **Keep `init` cheap and synchronous.** It runs once, before the server starts listening.

---

## 5. Verification Checklist

Before shipping a plugin:

1. `npm run typecheck` passes — plugins are part of the compiled tree.
2. The gateway starts and logs `Plugin loaded` with your plugin name and version.
3. A request through the gateway shows your mutation (header, body, or short-circuit).
4. With `LOG_LEVEL=warn` the plugin produces no per-request log noise.
5. Under load, `ctx.state` keys do not grow unbounded per request.
