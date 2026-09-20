---
title: "Operations & Configuration (F6)"
description: "Zero-dependency config loading and validation, plugin execution chain, auto-tuning."
order: 9
section: "Features"
---

All 3 features in this group are **implemented and verified** — each has a full FSD + ERD spec pair and unit/integration coverage in the repo test suite.

## Auto Tuner

The Auto-Tuner observes the gateway's load patterns (RPS, latency, CPU, active connections) over an
observation window, then recommends — or, in non-safe mode, applies — performance parameter
adjustments: connection pool size, worker thread count, buffer sizes, timeouts,
and cache sizes. Its goal is to keep p99 latency and resource utilization healthy without
manual operator intervention for routine tuning.

### Configuration

```jsonc
"performance": {
  "workerCount": 0,            // 0 = CPU count
  "contextPoolSize": 1000,
  "bufferPoolSize": 1000,
  "responsePoolSize": 1000,
  "enablePooling": true
}
```

`AutoTunerConfig` (from code, not the main config file):

```ts
{
  enabled: true,
  observationWindow: 300000,   // ms, 5 minutes
  minObservations: 10,
  safeMode: true,              // recommendations only, no auto-apply
  aggressiveness: 'moderate'   // conservative | moderate | aggressive
}
```

Changing `PERFORMANCE_CONFIG` in `config/gateway.config.json` still requires a restart
because the config is not hot-reloaded (see Config-Loader OP-006).

### Edge cases

- **Fewer observations than `minObservations`** → the window is skipped, no recommendation (prevents
  decisions from too-small samples).
- **All metrics zero** (idle gateway) → `calculateAverage` = 0 → only pool scale-down
  (< 30% utilization) and worker scale-down (CPU < 0.3) trigger; never below `min`.
- **Recommendation above max / below min** → clamped to the parameter bounds
  (`Math.min(param.max, ...)`, `Math.max(param.min, ...)`).
- **`safeMode: true`** (default) → no runtime mutation at all; the operator
  reads `getRecommendations()` and decides.
- **`applyOptimizations` called manually** → updates `param.current` in-memory;
  it doesn't write `gateway.config.json` and doesn't restart pools (see limitations below).
- **`startTuning()` called twice** → the second call is a no-op (guard `if (this.tuning) return`).
- **`updateParameter` with a value out of range** → clamped to [min, max].
- **History > 100 observations** → pruned to the last 100 (index filter).
- **Worker count recommended up** → recommendation only; applying it requires a process
  restart (worker threads can't be created/destroyed mid-flight by this file).
- **aggressiveness set but not yet affecting thresholds** → the field exists in the config;
  the current analysis uses fixed thresholds; documented so it isn't mistaken for active.


## Config Loader and Validator

Conventional gateways use external validation libraries (AJV, JSON schema). This project
commits to **zero-dependency**: `config/gateway.config.json` is the only
persistent artifact in the whole system, and every path that reads it is written natively —
Node.js stdlib only. This feature covers reading, environment-variable interpolation,
native validation, and configuration version migration.

- Reads `config/gateway.config.json` into a shape-guaranteed `ConfigFile`.
- Substitutes `${VAR}` / `${VAR:default}` placeholders without dependencies.
- Rejects malformed configuration at boot, not at the first failing request.
- Maintains backward compatibility: old-version configurations are migrated automatically.

`src/config/interpolation.ts`, `src/config/versioning.ts`.

### How it works

Boot flow (`ConfigLoader.load()`):

1. `fs/promises.readFile(configPath, 'utf-8')` — read the configuration file.
2. `JSON.parse` — syntax errors are thrown as `Invalid JSON in configuration file`.
3. `interpolateConfig(cfg, { strict: false })` when `options.interpolate` is enabled —
   recursive: strings, arrays, objects; the JSON path is tracked for error messages.
4. `configValidator.validateOrThrow(cfg)` — native validation, when `validate !== false`.
5. Server defaults are merged: `{ ...DEFAULT_SERVER, ...cfg.server }` — explicit values
   always win, missing keys get safe defaults.
6. The result is stored in `this.config`; `getConfig()` returns it.

Native validation (`ConfigValidator.validate`) checks: root must be an object (not an array);
`version` must match `^\d+\.\d+\.\d+$`; `environment` must be one of
`development | staging | production`; `server` must be an object, `server.port` an integer
1–65535, `server.host` a string. The result is `{ valid, errors: [{path, message, code}] }`.
`validateOrThrow` combines all errors into one message (every violation
reported at once, not one at a time).

Interpolation uses the regex
`/\$\{([A-Z_][A-Z0-9_]*?)(?::([^}]*))?\\}/g`:

- `${PORT}` → the value of `process.env.PORT`; when missing and `strict: true`, throw
  `InterpolationError(variable, path)`.
- `${PORT:3000}` → `3000` as a literal default.
- Non-strict (the loader's mode) → the placeholder is left as-is.
- `extractEnvVars()` and `validateEnvVars()` scan references without performing
  substitution — for documentation and pre-flight checks.

Versioning (`ConfigVersionManager`, current `1.2.0`): `parseVersion` X.Y.Z,
`compareVersions` per component, `isCompatibleVersion` (same major, or exactly one major
behind), `migrateToCurrentVersion` walks upward patch → minor → major and
applies registered migrations (`1.0.0 → 1.1.0` plants `performance.contextPoolSize = 1000`;
`1.1.0 → 1.2.0` is a compatible no-op).

### Configuration

```jsonc
{
  "version": "1.0.0",            // required, pattern ^\d+\.\d+\.\d+$
  "environment": "development",  // required: development | staging | production
  "server": {                    // server config, see OP-002
    "port": 3000, "host": "0.0.0.0",
    "keepAlive": true, "keepAliveTimeout": 65000,
    "requestTimeout": 30000, "maxHeaderSize": 16384, "maxBodySize": 10485760
  },
  "routes": [ { "method": "GET", "path": "/api/:id", "priority": 0 } ],
  "upstreams": [ /* id, protocol, host, port, basePath, poolSize, timeout, healthCheck */ ],
  "plugins": [ { "name": "request-id", "enabled": true, "settings": {} } ],
  "performance": { "workerCount": 0, "contextPoolSize": 1000, "bufferPoolSize": 1000,
                   "responsePoolSize": 1000, "enablePooling": true }
}
```

Loader options: `{ configPath, validate?: boolean, interpolate?: boolean }`.
`createConfigLoader` also accepts `hotReload`, `reloadInterval`, `defaults` (accepted
as parameters, currently unused by the loader implementation — see OP-006).

Environment variables are referenced with `${VAR}` / `${VAR:default}` in any
string value.

### Edge cases

- **Missing configuration file** → `readFile` throws `ENOENT`; boot fails with a
  clear message. No implicit config fallback.
- **Broken JSON syntax** → `Invalid JSON in configuration file: <parse message>` — part
  of the parser error, never swallowed.
- **Root is an array / string** → `Configuration must be an object`, `code: 'type'`.
- **`${VAR}` missing, strict** → `InterpolationError` carrying the variable name and path
  (`upstreams[0].host`) — traceable to the exact key.
- **`${VAR}` missing, non-strict** → the placeholder is preserved verbatim; validation
  afterwards rejects the illegal value.
- **Port not an integer / out of range** → `must be <= 65535 and >= 1 integer`,
  `code: 'maximum'`.
- **Missing server key** → `must be object`; all errors are collected then thrown
  at once.
- **Config version two minors behind** → `validateVersion` rejects it
  (`not compatible`); migration only accepts the same major or one major behind.
- **Free-form version** (`v1.0`) → rejected in `parseVersion` and in `validate`
  (pattern `^\d+\.\d+\.\d+$`).
- **Nested interpolation** (`${A_${B}}`) → unsupported; the regex handles one level only.
- **Server defaults + explicit values** → the spread `{...DEFAULT_SERVER, ...cfg.server}`
  is safe: explicit always wins.


## Plugin Execution Chain

The plugin system is the gateway's main extension point: all cross-cutting logic
(rate limiting, header transformation, logging, auth) runs as plugins, not
hard-coded in the request pipeline. This feature defines lifecycle hooks, execution
order, per-plugin timeouts, short-circuiting, and the set of built-in plugins.

- Provides the plugin contract (`Plugin` interface) with clear lifecycle hooks.
- Executes hooks in order with timeouts, metrics, and an error boundary per plugin.
- Ships ready-to-use built-in plugins, without external dependencies.
- Honest status: the `auth-jwt` plugin is still **in-progress / uncommitted** in the working tree.

`src/plugins/context-manager.ts`, `src/plugins/metrics.ts`, `src/plugins/builtin/*`.

### Configuration

```jsonc
"plugins": [
  { "name": "request-id", "enabled": true,
    "settings": { "headerName": "x-request-id", "prefix": "req-", "overwrite": false } },
  { "name": "rate-limit", "enabled": true,
    "settings": { "capacity": 100, "refillRate": 50 } },
  { "name": "header-transformer", "enabled": true,
    "settings": { "request": { "set": { "x-gateway": "tsg" } } } },
  { "name": "auth-jwt", "enabled": true,          // IN-PROGRESS, uncommitted
    "settings": { "issuer": "https://auth.example", "audience": "api",
                  "jwks": { "keys": [ /* JWK RSA */ ] },
                  "publicRoutes": ["/", "/health"], "leewaySeconds": 30 } }
]
```

Execution-chain options: `{ timeout: 5000, collectMetrics: true, enableCaching: false,
shortCircuitOnError: false }`.

### Edge cases

- **Plugin `init()` throws** → logged at `error`, the plugin stays registered; real
  failures surface when hooks execute (fail-late, not a failed boot).
- **A plugin hook hangs** → the timeout (default 5000 ms) throws
  `Plugin <name>.<hook> timed out after <N>ms`; recorded with `timedOut: true`, the chain
  continues to the next plugin.
- **Plugin short-circuits** (`ctx.responded = true`, e.g. rate-limit 429) → the rest of the
  chain is skipped, recorded with `shortCircuited: true`; the proxy is never called.
- **Plugin doesn't implement that hook** → fast skip, result
  `success: true, duration: 0`.
- **Plugin throws an error** → caught, `success: false`, the chain continues unless
  `shortCircuitOnError: true`.
- **Corrupt plugin file / invalid export** → the loader skips the file, logs `warn`, other
  plugins still load.
- **`onError` is only called when an error param exists** — the wrapper skips the call
  when there is no error.
- **Duplicate plugin name** → the `Map` overwrites the old wrapper (last registration wins).
- **auth-jwt with invalid JWKS** → verification fails → request rejected 401 (plugin
  path); the feature status remains in-progress until committed.
- **Runtime enable/disable** → `wrapper.enabled` and the metrics collector stay in sync;
  disabled plugins are skipped without execution.
