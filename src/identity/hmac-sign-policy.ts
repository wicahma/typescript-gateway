import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { GatewayPolicy } from '../pipeline/policy.js';
import { RequestContext } from '../types/core.js';
import { HttpProblems } from '../pipeline/http-problems.js';
import { UpstreamCredentialStore } from './upstream-credential-store.js';
import { logger } from '../utils/logger.js';

export interface HmacSignPolicyConfig {
  credentialName: string;
  publicRoutes?: string[];
}

const DEFAULT_PUBLIC_ROUTES = ['/', '/health', '/metrics'];

export function verifyHmacSignature(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  body: Buffer | null,
  signature: string,
  maxAgeSeconds = 300,
): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > maxAgeSeconds) return false;
  const digest = createHash('sha256').update(body ?? Buffer.alloc(0)).digest('hex');
  const canonical = `${method}\n${path}\n${timestamp}\n${digest}`;
  const expected = createHmac('sha256', secret).update(canonical).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export class HmacSignPolicy implements GatewayPolicy {
  readonly name = 'upstream-hmac-signature';

  private readonly publicRoutes: Set<string>;

  constructor(
    private store: UpstreamCredentialStore,
    private config: HmacSignPolicyConfig,
  ) {
    this.publicRoutes = new Set(config.publicRoutes ?? DEFAULT_PUBLIC_ROUTES);
  }

  executeInbound(ctx: RequestContext): Response | void {
    if (this.publicRoutes.has(ctx.path)) return;

    if (!ctx.state['user']) {
      return HttpProblems.unauthorized('Caller authentication required before upstream injection.');
    }

    const credential = this.store.getHmacSecret(this.config.credentialName);
    if (!credential) {
      logger.error(
        { requestId: ctx.requestId, credential: this.config.credentialName },
        'Upstream HMAC credential missing or has no hmac block',
      );
      return HttpProblems.internal('Upstream credential not configured.');
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodyDigest = createHash('sha256').update(ctx.body ?? Buffer.alloc(0)).digest('hex');
    const canonical = `${ctx.method}\n${ctx.path}\n${timestamp}\n${bodyDigest}`;
    const signature = createHmac('sha256', credential.secret).update(canonical).digest('base64');

    const namespace = credential.headerNamespace;
    const signatureHeader = namespace ? `${namespace}-signature` : 'x-signature';
    const timestampHeader = namespace ? `${namespace}-timestamp` : 'x-timestamp';
    ctx.headers[signatureHeader] = signature;
    ctx.headers[timestampHeader] = timestamp;
    if (credential.keyId) ctx.headers['x-key-id'] = credential.keyId;
  }
}
