---
title: "Payload Handling"
description: "Body parsing, request/response transformation, and native compression."
order: 7
section: "Features"
track: "reference"
---

All 4 features in this group are **implemented and verified** — each has a full FSD + ERD spec pair and unit/integration coverage in the repo test suite.

## Body Parser

- **Spec:** A stream-based request body parser for a zero-dependency gateway. Accepts a Node.js `IncomingMessage` and returns a structured `ParsedBody` per Content-Type: JSON, URL-encoded, multipart, text, and raw binary (fallback `application/octet-stream`).
- **Purpose:** Act as the first trust boundary for inbound payloads — enforcing per-content-type size limits, bounding stream read time, and normalizing the body before it is passed to the request transformer, plugins, and upstream.

### How it works

1. Detect Content-Type from the header (parameters like `charset` ignored; keyword matching `json`/`urlencoded`/`multipart`/`text`; no header → `application/octet-stream`).
2. Pre-check `Content-Length` against the per-type limit (`limits.json`, `limits.urlencoded`, `limits.multipart`, `limits.text`); violations are rejected immediately without reading the stream (`BODY_TOO_LARGE`, HTTP 413).
3. Read the stream via `readBody()`: accumulate chunks into a `Buffer[]` array, verify the total byte count against the claimed `Content-Length` (`SIZE_EXCEEDED`, HTTP 413 — protects against forged headers), a `timeout` timer (default 30000 ms) destroys the connection (`TIMEOUT`, HTTP 408), the `error` event → `STREAM_ERROR`.
4. Per-type transformation: JSON → `JSON.parse` (`INVALID_JSON`, 400); URL-encoded → own query-string parser with multi-value support as arrays (`INVALID_URLENCODED`, 400); multipart → raw buffer (full part parsing deliberately not built, see Out of Scope in the FSD); text → UTF-8 string; raw → buffer as-is.
5. The resulting `ParsedBody { data?, buffer?, stream?, contentType, size }` is used by `ProxyHandler` (pipeline Step 3) as a transient `BODY_BUFFER` — released with the end of the request, never persisted.

### Configuration

- `gateway.config.json → bodyParser` (`BodyParserConfig` in `src/types/core.ts`):
  - `enabled` (boolean, default `true`)
  - `limits` (bytes): `json` 1 MB, `urlencoded` 1 MB, `multipart` 10 MB, `text` 1 MB
  - `timeout` (ms, default 30000)
  - `enablePooling` (boolean, default `true`) — pools `ParsedBody` per type (max 100 entries per pool)
- Pipeline level: `enableBodyParsing` on `ProxyHandlerConfig` (default `true`) decides whether parsing is called at all.
- Global request limit: `maxRequestSize` (default 10 MB) is verified first by `ProxyHandler`.

### Edge cases

- **Forged `Content-Length` (smaller than the real body):** `readBody` accumulation detects `totalLength > expectedLength`, the stream is destroyed, HTTP 413.
- **No `Content-Length` (chunked):** `getContentLength` returns 0, the pre-check is skipped; limits are still enforced via `SIZE_EXCEEDED` only when the header is present — chunked bodies are checked against per-type limits while being read.
- **Slow streaming (slowloris):** the 30 s timer destroys the socket, HTTP 408.
- **Large syntactically valid JSON above the limit:** rejected before `JSON.parse` — no CPU wasted on a payload that would be rejected anyway.
- **Unknown Content-Type:** falls back to the raw buffer; the gateway can still proxy it without understanding the contents.


## Compression Handler

- **Spec:** A response HTTP compressor based on `node:zlib` — gzip, Brotli (`br`), and deflate — with `Accept-Encoding` negotiation (q-value and wildcard `*` support), content-type filtering, a minimum size threshold, and writing the `Content-Encoding` / `Content-Length` / `Vary: Accept-Encoding` headers.
- **Purpose:** Save bandwidth without an external dependency (stdlib `node:zlib`), with a configurable preference order (Brotli first by default because of its best ratio for JSON/text).

### How it works

1. **Negotiation** (`negotiateAlgorithm(acceptEncoding)`): parse the header into a list of `{ encoding, quality }` (q defaults to 1.0, q ≤ 0 dropped), sort by descending quality, then pick the first algorithm from `config.algorithms` (server preference order) that the client accepts or that `*` covers. No header / `enabled=false` → `null` (identity).
2. **Filter** (`shouldCompress(contentType, contentLength, acceptEncoding)`): compress only when enabled, the client sent `Accept-Encoding`, size ≥ `threshold` (default 1024 bytes), and the content-type matches `contentTypes` (default: `application/json`, `text/*`, `application/javascript`, `application/xml`; wildcard `*` → regex; parameters like `; charset` are stripped).
3. **Compression** (`compress(data, algorithm)`): pipe `Readable.from([data])` into a `createGzip`/`createBrotliCompress`/`createDeflate` stream with `level` (default 6; Brotli uses the quality param), collect chunks → `CompressionResult { data, algorithm, originalSize, compressedSize, ratio, duration }`.
4. **Headers** (`addCompressionHeaders`): set `content-encoding` = algorithm, `content-length` = compressed size, overwrite `vary` with `Accept-Encoding` (existing Vary removed for consistency).
5. **Detection & decompression**: `detectAlgorithm(contentEncoding)` recognizes `gzip`/`x-gzip`/`br`/`deflate` — used for compressed upstream bodies; `decompress()` + `createDecompressionStream()` provide the reverse path. A stream variant (`createCompressionStream`) is available for direct streaming pipelines.
6. In the pipeline: `ProxyHandler` Step 7 calls `shouldCompress` → `negotiateAlgorithm` → `compress` → `addCompressionHeaders` (always **after** the Response-Transformer, so the compressed body is final). Metrics `originalSize`/`compressedSize`/`duration` are recorded into `advancedMetrics.recordCompression()`.

### Configuration

- `CompressionConfig` (changeable at runtime via `updateConfig()`):
  - `enabled` (default `true`); `algorithms: ['br', 'gzip', 'deflate']` (order = preference)
  - `level`: 6 (0–9 gzip/deflate, 0–11 Brotli quality)
  - `threshold`: 1024 bytes
  - `contentTypes`: `['application/json', 'text/*', 'application/javascript', 'application/xml']`
- Pipeline switch: `enableCompression` on `ProxyHandlerConfig` (default `true`).
- `getStats()` / `getConfig()` for introspection.

### Edge cases

- **Client without `Accept-Encoding`:** not compressed (identity), per RFC 7231.
- **`Accept-Encoding: *`:** mapped to the first configured algorithm.
- **q=0:** encoding considered not accepted, dropped before matching.
- **Payload below the threshold:** sent as-is — compressing small payloads often enlarges them + wastes CPU.
- **Unlisted content-type (e.g. images):** sent raw; compressing already-compressed media is ineffective.
- **`x-gzip`:** recognized as gzip (legacy compatibility).
- **Empty buffer / small payload:** the compress-decompress round-trip stays correct (covered by Edge Cases tests).


## Request Transformer

- **Spec:** A declarative request transformation engine running in the gateway pipeline (Step 2, before body parsing and upstream selection). It can rewrite headers, query parameters, path, and body (JSON/form) based on per-route rules with conditions (header, path, method, query param) and priority.
- **Purpose:** Remove the need for upstreams to handle client variation — header normalization, stripping internal parameters, legacy path rewrites, body field injection — all at the edge, without external dependencies.

### How it works

1. `RequestTransformation` rules are registered via `addTransformation()` / `setTransformations()`; automatically sorted by descending `priority` (highest executes first).
2. `transform(method, path, headers, body)` clones the headers (never mutates the input), then for each rule passing `shouldApply()`:
   - **headers**: `add` (normalized to lowercase), `remove` (exact or wildcard `*` → case-insensitive regex), `rename`, `modify` (string replacement with regex).
   - **query**: `add`/`remove`/`modify` via `URLSearchParams` — `add` uses `set` so it overwrites duplicate values.
   - **pathRewrite**: a list of `{ pattern, replacement }` rules; the path is split from the query string first, then regex `test` followed by `replace`.
   - **body**: JSON (`application/json`, `application/vnd.api+json`) → `set`/`remove` by dot-path; form (`x-www-form-urlencoded`) → `set`/`remove` via `URLSearchParams`.
3. Conditions `shouldApply()`: `routes` (wildcard pattern), `conditions.header` (exact/RegExp), `conditions.path`, `conditions.method` (string/array), `conditions.queryParam` (presence).
4. The resulting `TransformationResult { headers, path, queryString, body?, duration }` — the final path is reconstructed as `pathWithoutQuery?queryString`. Duration is recorded into `advancedMetrics.recordRequestTransformation()` when enabled.
5. A failed body transform (broken JSON) **does not** throw: the original body is forwarded as-is and the failure is logged at `error` level — fail-open so user requests are never dropped by cosmetic transformations.

### Configuration

- `enableRequestTransformations` on `ProxyHandlerConfig` (default `true`) — the pipeline switch.
- Rules are registered programmatically via `ProxyHandler.getRequestTransformer()`; there is no `requestTransformations` section in `gateway.config.json` (declarative config to follow, see FSD Out of Scope).
- `getStats()` exposes `totalTransformations`; `clear()` removes all rules.

### Edge cases

- **Prototype pollution:** `setJsonPath`/`deleteJsonPath` block the `__proto__`, `constructor`, `prototype` segments — logged at `warn` and the path ignored.
- **Broken JSON body under a body rule:** the original body is forwarded without an error to the client.
- **Array-valued headers:** the first value is used for conditions and `modify`.
- **pathRewrite rule with an invalid regex:** the regex is compiled at execution time; the error propagates to the pipeline caller.
- **Equal priorities:** stable insertion order after sorting.


## Response Transformer

- **Spec:** A declarative response transformation engine in the gateway pipeline (Step 6, after upstream proxying completes, before compression). It changes the status code (mapping), headers, JSON body (wrap/set/remove), CORS, and replaces error bodies with per-status-code templates — based on per-route rules with conditions and priority.
- **Purpose:** Hide upstream quirks from clients: normalize status codes, inject security/CORS headers, wrap responses in a consistent envelope, and replace raw upstream error pages with gateway templates.

### How it works

1. `ResponseTransformation` rules are registered via `addTransformation()` / `setTransformations()`; sorted by descending `priority`.
2. `transform(requestPath, statusCode, headers, body)` clones the headers, then for each rule passing `shouldApply()`:
   - **statusCodeMap**: `upstream code → gateway code` (looks up the code already transformed by previous rules — cross-rule chaining).
   - **headers**: `add` (lowercase), `remove` (exact/wildcard `*`), `rename`.
   - **cors** (`enabled: true`): set `access-control-allow-origin` (`*` or the first origin from the allow-list), `-allow-methods`, `-allow-headers`, `-expose-headers`, `-allow-credentials`, `-max-age`.
   - **errorTemplates** (only when status ≥ 400): the first template whose `statusCodes` match replaces the body (string or object → JSON) + the template's extra headers.
   - **body**: JSON (`application/json`, `application/vnd.api+json`) → `wrap` (wraps the whole payload in a single field), `set`, `remove` by dot-path.
3. Conditions `shouldApply()`: `routes` (wildcard), `conditions.statusCode` (number/array), `conditions.header`, `conditions.contentType` (string includes / RegExp).
4. The resulting `ResponseTransformationResult { statusCode, headers, body?, duration }`; duration is recorded into `advancedMetrics.recordResponseTransformation()`.
5. A failed body transform (broken JSON) → the original body is forwarded, logged at `error` — fail-open, same as the Request-Transformer.

### Configuration

- `enableResponseTransformations` on `ProxyHandlerConfig` (default `true`) — the pipeline switch.
- Rules programmatically via `ProxyHandler.getResponseTransformer()`; no declarative section in `gateway.config.json` (see FSD Out of Scope).
- `getStats()` → `totalTransformations`; `clear()` resets.

### Edge cases

- **Upstream already sent CORS:** the `add` rule overwrites the upstream header — the operator decides the final CORS policy at the gateway.
- **Error template triggered on a binary body:** the template replaces the body as-is (templates only apply to status ≥ 400, this case is intentional).
- **Cross-rule statusCodeMap chaining:** lower-priority rules read the result of higher-priority mappings; the `statusCode` condition is checked against the original code (pre-mapping).
- **Broken JSON body under a body rule:** the original body is forwarded, the client never sees a 500 from the transformer.
- **Prototype pollution:** `__proto__`/`constructor`/`prototype` blocked in `setJsonPath`/`deleteJsonPath`.
