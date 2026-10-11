---
title: "Deep Dive"
description: "How each feature actually behaves: configuration surface, tradeoffs, interactions, and failure modes."
---

Guides show you what to type. Deep Dive explains what the gateway does with it. Every page here takes one feature group and covers it end to end: the configuration surface, the defaults and why they were chosen, how the feature interacts with the request pipeline, and what happens when it fails.

## Who this section is for

- Developers already running the gateway who need to tune it rather than start it.
- Engineers designing for production: retries, timeouts, circuit breaking, caching, auth, observability.
- Reviewers who need to judge whether a feature fits their workload before adopting it.

## Structure: What it does

Each page explains the subsystem behaviour in plain terms, outlining architectural responsibilities, data structures, and baseline guarantees.

## Structure: Configuration

Every page covers every configuration option, its type, its default, and its exact runtime effect.

## Structure: Interactions

Every page details how the feature composes with the rest of the pipeline, identifying exact hook positions and upstream communication stages.

## Structure: Tradeoffs and failure modes

Every page describes the operational cost of enabling the feature, memory overhead, and behaviour under upstream degradation or resource exhaustion.

## Topics

| Topic | Description |
| --- | --- |
| [Architecture](/docs/deep-dive/architecture/) | Request lifecycle, socket to upstream, process model |
| [Core Routing](/docs/deep-dive/core-routing/) | Radix router, connection pooling, proxy forwarding |
| [Resilience](/docs/deep-dive/resilience/) | Circuit breakers, retries, active health checks |
| [Traffic Control](/docs/deep-dive/traffic-control/) | Rate limiting, response caching, load balancing |
| [Payload Handling](/docs/deep-dive/payload/) | Body parsing, streaming, gzip and brotli compression |
| [Observability](/docs/deep-dive/observability/) | Prometheus metrics, structured logs, live dashboard |
| [Operations](/docs/deep-dive/operations/) | Config validation, plugin hooks, auto-tuning |
| [Identity & Security](/docs/deep-dive/identity-security/) | JWT validation, API keys, RFC 7807 problem details |
| [Feature Matrix](/docs/deep-dive/features/) | Capability inventory and performance ceilings |
| [Feature Pack](/docs/deep-dive/feature-pack/) | Advanced extensions and deployment configurations |

## How it relates to the other sections

- Start from [Guides](/docs/guides/) if you have not run the gateway yet.
- Go to [Reference](/docs/reference/) when you need a signature, a return type, or the file that implements something you read about here.
