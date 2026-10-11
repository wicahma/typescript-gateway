---
title: "Payload Handling"
description: "Body parsing, request/response transformation, and native compression."
---

Every feature in this group is **implemented and verified**, each with unit and integration coverage in the repo test suite.

## What It Does

The payload subsystem handles request body decoding, content transformations, and response compression without external dependencies.

### Body Parser

The Body Parser is the gateway's first trust boundary for inbound payloads:
- **Streaming Ingestion**: Stream-based body reading for JSON, URL-encoded, multipart, text, and raw binary formats.
- **Content Boundary Enforcement**: Enforces per-type byte limits before reading streams, defending against slowloris and oversized payload attacks.
- **Header Integrity**: Verifies cumulative byte counts against declared `Content-Length` headers, rejecting forged headers with HTTP 413.

### Compression Handler

The Compression Handler provides zero-dependency stream compression using `node:zlib`:
- **Algorithm Negotiation**: Evaluates client `Accept-Encoding` quality parameters (`q-values`) against server algorithm preferences (`br`, `gzip`, `deflate`).
- **Content Filtering**: Compresses payloads only when payload size exceeds a threshold (default 1024 bytes) and matches compressible MIME types (`application/json`, `text/*`, `application/xml`).
- **Header Synchronization**: Injects `Content-Encoding`, updates `Content-Length`, and manages `Vary: Accept-Encoding`.

### Request Transformer

A declarative engine executing before upstream forwarding:
- **Header and Path Rewriting**: Modifies, renames, and scrubs headers, rewrites URL query strings, and applies regex path substitutions.
- **Body Rewriting**: Injects or removes JSON fields using dot-path syntax (`data.user.id`) or alters URL-encoded forms.
- **Prototype Defense**: Automatically blocks prototype pollution vectors (`__proto__`, `constructor`, `prototype`).

### Response Transformer

Executes after upstream proxy responses arrive:
- **Status Mapping**: Translates upstream HTTP status codes to standardized client codes.
- **Envelope Wrapping**: Encapsulates raw backend payloads in standardized JSON envelopes.
- **CORS Injection & Error Templating**: Overrides CORS headers and swaps upstream error pages with standard gateway problem JSON.

## Configuration

Payload options are specified in `gateway.config.json` and internal handler configurations:

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `bodyParser.enabled` | boolean | `true` | Enables inbound request body parsing. |
| `bodyParser.limits.json` | number | `1048576` | Maximum allowed JSON payload size (1 MB). |
| `bodyParser.limits.urlencoded` | number | `1048576` | Maximum allowed URL-encoded payload size (1 MB). |
| `bodyParser.limits.multipart` | number | `10485760` | Maximum allowed multipart payload size (10 MB). |
| `bodyParser.timeout` | number | `30000` | Stream read timeout in milliseconds before socket teardown. |
| `compression.enabled` | boolean | `true` | Enables HTTP response compression. |
| `compression.algorithms` | array | `["br", "gzip", "deflate"]` | Preferred server compression algorithms in priority order. |
| `compression.level` | number | `6` | Compression efficiency level (0-9 for gzip/deflate, 0-11 for Brotli). |
| `compression.threshold` | number | `1024` | Minimum payload size in bytes required to trigger compression. |
| `proxy.enableRequestTransformations` | boolean | `true` | Toggles inbound request header and body transformation rules. |
| `proxy.enableResponseTransformations` | boolean | `true` | Toggles outbound response status and header transformation rules. |

## Interactions

Payload components operate at the ingress and egress borders of the request pipeline:

1. **Ingress Parsing (Step 1-3)**: `ProxyHandler` checks overall request size, runs `RequestTransformer` rules to rewrite paths and headers, and executes `BodyParser` on incoming streams.
2. **Upstream Forwarding**: Normalized request headers and parsed body buffers are forwarded across `HttpClientPool`.
3. **Egress Transformation (Step 6)**: The upstream response is intercepted by `ResponseTransformer` to apply status mapping, CORS headers, and error templates.
4. **Compression (Step 7)**: `CompressionHandler` negotiates encodings with client headers and streams compressed bytes to the client socket.

## Tradeoffs and Failure Modes

- **Fail-Open Transformation Semantics**: If a JSON body rewrite fails due to malformed upstream content, the transformer logs an error and forwards the original payload untouched rather than returning a 500 Internal Server Error.
- **Compression CPU Overhead**: Brotli and gzip compression introduce CPU overhead on high-throughput nodes. The 1024-byte threshold avoids wasting cycles compressing small payloads where compression ratios are negligible or negative.
- **Chunked Payload Handling**: Chunked requests lacking `Content-Length` bypass pre-check size evaluation but are guarded during stream consumption, aborting with HTTP 413 if the consumed byte count exceeds limits.
- **Memory Consumption during Transformation**: Parsing and rewriting large JSON payloads requires buffering into memory. For large static files or media streams, transformation should be disabled so requests can traverse the zero-allocation streaming path.
