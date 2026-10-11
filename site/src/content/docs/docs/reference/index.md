---
title: "Reference"
description: "Every exported symbol in the gateway, grouped by module, with signatures and source paths."
---

Reference is the map of the codebase. One page per module under `src/`, listing every exported class, function, constant, interface, and type with its signature, what it is for, and where it lives. It is written for people who read, extend, or review the gateway's internals.

## Who this section is for

- Contributors adding a feature, a plugin, or a policy.
- Reviewers checking whether an internal is used correctly elsewhere.
- Anyone integrating against the gateway as a library rather than running it as a process.

## What you can do with it

- Find the exact signature of anything exported from `src/`.
- Follow a symbol back to its file and see what it depends on.
- Understand the module boundaries — what belongs in `core`, `pipeline`, `identity`, and so on — before adding code.

## How to read it

Each page covers one module. It opens with a one-paragraph summary of the module's responsibility, then a table of every export, then notes on the non-obvious ones. Signatures are copied from source; if a signature here disagrees with the source, the source wins — open an issue.

Pages are ordered by dependency, not alphabetically. [Entrypoints](/docs/reference/entrypoints/) and [Types](/docs/reference/types/) are the best starting points because everything else depends on them.

## Modules

| Module | Description |
| --- | --- |
| [Entrypoints](/docs/reference/entrypoints/) | Gateway bootstrap and top-level exports |
| [Core Engine](/docs/reference/core/) | HTTP server, radix router, connection pools, cache |
| [Pipeline](/docs/reference/pipeline/) | Middleware policies and execution chain |
| [Plugins](/docs/reference/plugins/) | Plugin lifecycle hooks and built-in handlers |
| [Identity](/docs/reference/identity/) | API key crypto and consumer management |
| [Config](/docs/reference/config/) | Schema validation and auto-tuning |
| [Types](/docs/reference/types/) | Core interfaces and contract types |
| [Utils](/docs/reference/utils/) | Logger, object pool, and metrics buffers |
| [Profiling](/docs/reference/profiling/) | V8 CPU profiler and heap snapshots |
| [Monitoring](/docs/reference/monitoring/) | Performance monitors and alerts |
| [Observability](/docs/reference/observability/) | Prometheus exposition format |
| [Admin](/docs/reference/admin/) | Administrative management endpoints |
| [Testing](/docs/reference/testing/) | Test suites and benchmark harnesses |

## Related sections

- [Deep Dive](/docs/deep-dive/) explains behaviour and configuration; Reference explains structure and signatures.
- [Guides](/docs/guides/) is the place to start if you only want to run the gateway.
