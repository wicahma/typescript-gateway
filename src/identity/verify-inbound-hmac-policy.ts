import { GatewayPolicy } from '../pipeline/policy.js';
import { RequestContext } from '../types/core.js';
import { HttpProblems } from '../pipeline/http-problems.js';
import { verifyHmacSignature } from './hmac-sign-policy.js';

export interface VerifyInboundHmacConfig {
  secret: string;
  headerName?: string;
  timestampHeader?: string;
  publicRoutes?: string[];
  maxAgeSeconds?: number;
  maxBodyBytes?: number;
}

const DEFAULT_PUBLIC_ROUTES = ['/', '/health', '/metrics'];
const DEFAULT_MAX_AGE_SECONDS = 300;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const BODYLESS_METHODS = new Set(['GET', 'HEAD', 'DELETE', 'OPTIONS']);

function readBodyStream(req: RequestContext['req'], maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (err: Error | null, out: Buffer) => {
      if (settled) return;
      settled = true;
      err ? reject(err) : resolve(out);
    };
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        finish(new Error('ERR_BODY_TOO_LARGE_FOR_VERIFICATION'), Buffer.alloc(0));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(null, Buffer.concat(chunks)));
    req.on('error', (err: Error) => finish(err, Buffer.alloc(0)));
  });
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export class VerifyInboundHmacPolicy implements GatewayPolicy {
  readonly name = 'verify-inbound-hmac';

  private readonly secret: string;
  private readonly headerName: string;
  private readonly timestampHeader: string;
  private readonly publicRoutes: Set<string>;
  private readonly maxAgeSeconds: number;
  private readonly maxBodyBytes: number;

  constructor(config: VerifyInboundHmacConfig) {
    this.secret = config.secret;
    this.headerName = config.headerName ?? 'x-signature';
    this.timestampHeader = config.timestampHeader ?? 'x-timestamp';
    this.publicRoutes = new Set(config.publicRoutes ?? DEFAULT_PUBLIC_ROUTES);
    this.maxAgeSeconds = config.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
    this.maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  }

  async executeInbound(ctx: RequestContext): Promise<Response | void> {
    if (this.publicRoutes.has(ctx.path)) return;

    const signature = firstHeader(ctx.headers[this.headerName]);
    if (!signature) return HttpProblems.unauthorized('Missing signature');

    const timestamp = firstHeader(ctx.headers[this.timestampHeader]);
    if (!timestamp) return HttpProblems.unauthorized('Missing signature');

    let body: Buffer;
    if (ctx.body !== null) {
      body = ctx.body;
    } else if (BODYLESS_METHODS.has(ctx.method)) {
      body = Buffer.alloc(0);
    } else {
      try {
        body = await readBodyStream(ctx.req, this.maxBodyBytes);
        ctx.body = body;
      } catch {
        return HttpProblems.unauthorized('Invalid signature', { requestId: ctx.requestId });
      }
    }

    const valid = verifyHmacSignature(
      this.secret,
      ctx.method,
      ctx.path,
      timestamp,
      body,
      signature,
      this.maxAgeSeconds
    );

    if (!valid) {
      return HttpProblems.unauthorized('Invalid signature', { requestId: ctx.requestId });
    }
  }
}
