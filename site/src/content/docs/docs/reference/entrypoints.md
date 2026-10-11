---
title: "Entrypoints"
description: "Public API gateway entrypoints and root exports."
---

The entrypoints module provides the root interfaces and instantiation hooks for the TypeScript Gateway. It acts as the primary boundary for embedding the gateway programmatically within Node.js applications or spinning it up via command-line execution. Requests enter the gateway lifecycle through the server and router instances initialized here.

## Exports

| Symbol | Kind | Signature | Purpose |
| --- | --- | --- | --- |
| `Gateway` | class | `class Gateway` | Class export for Gateway. |
| `{ OpenApiDoc, OpenApiInfo }` | type | `type { OpenApiDoc, OpenApiInfo } from './core/openapi-generator.js'` | Type export for { OpenApiDoc, OpenApiInfo }. |

## Notes

### Gateway
The `Gateway` class orchestrates server setup, configuration ingestion, and pipeline assembly.

### OpenApiDoc
Exported OpenAPI types define contract structures when generating documentation from routes.

## Source

- `src/index.ts`
- `src/cli.ts`

## See also

- [Deep Dive: Architecture](/docs/deep-dive/architecture/)
