---
title: "Guides"
description: "Start here: install the gateway, point it at an upstream, and ship a working config in minutes."
---

The Guides section exists because the fastest way to judge a gateway is to run one. Every page here is self-contained: you can read any single one first, and none of them require you to understand how the gateway works internally.

## Who this section is for

- Developers who already have an HTTP service and want a gateway in front of it.
- Teams comparing TypeScript Gateway against nginx, Envoy, or Kong.
- Anyone who needs a working `gateway.json` today rather than a design document.

If you have never run the gateway before, read the pages in order. If you already run it and need a specific recipe, jump straight to [Usage](/docs/guides/usage/).

## What you can do with it

| Page | After reading it you can |
| --- | --- |
| [Getting Started](/docs/guides/getting-started/) | Install the gateway and proxy your first request. |
| [Configuration](/docs/guides/configuration/) | Write a `gateway.json` and know how it is validated. |
| [Usage](/docs/guides/usage/) | Copy working recipes for auth, rate limits, caching, and load balancing. |

## What this section deliberately leaves out

Guides show you the shortest path to a result. They do not explain *why* a default is what it is, how the request pipeline is ordered, or which internals a feature touches. When a recipe stops being enough — you need to tune the circuit breaker, understand pipeline ordering, or read the metrics surface — continue to [Deep Dive](/docs/deep-dive/). When you need the exact signature of a class or function, go to [Reference](/docs/reference/).
