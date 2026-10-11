---
title: "Deep Dive"
description: "How each feature actually behaves: configuration surface, tradeoffs, interactions, and failure modes."
---

Guides show you what to type. Deep Dive explains what the gateway does with it. Every page here takes one feature group and covers it end to end: the configuration surface, the defaults and why they were chosen, how the feature interacts with the request pipeline, and what happens when it fails.

## Who this section is for

- Developers already running the gateway who need to tune it rather than start it.
- Engineers designing for production: retries, timeouts, circuit breaking, caching, auth, observability.
- Reviewers who need to judge whether a feature fits their workload before adopting it.

## What you can do with it

Each page follows the same shape, so you can read the one you need and ignore the rest:

1. **What it does** — the behaviour in plain terms.
2. **Configuration** — every option, its type, its default, and its effect.
3. **Interactions** — how it composes with the rest of the pipeline and in what order.
4. **Tradeoffs and failure modes** — the cost of enabling it and what it does under load.

## How it relates to the other sections

- Start from [Guides](/docs/guides/) if you have not run the gateway yet.
- Go to [Reference](/docs/reference/) when you need a signature, a return type, or the file that implements something you read about here.
