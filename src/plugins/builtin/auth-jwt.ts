import { createPublicKey, verify } from 'crypto';
import { Plugin } from '../../types/plugin.js';
import { RequestContext } from '../../types/core.js';
import { logger } from '../../utils/logger.js';
import { metrics } from '../../utils/metrics.js';

export interface JWK {
  kty: string;
  n: string;
  e: string;
  kid?: string;
  alg?: string;
  use?: string;
}

export interface AuthJwtConfig {
  enabled?: boolean;
  issuer?: string;
  audience?: string;
  jwks?: { keys: JWK[] };
  leewaySeconds?: number;
  publicRoutes?: string[];
}

export class AuthJwtPlugin implements Plugin {
  name = 'auth-jwt';
  version = '1.0.0';
  description = 'OAuth2 / JWT Resource Server verification against local JWKS';
  author = 'Builder';

  private config: AuthJwtConfig;
  private publicRoutesSet: Set<string>;
  private keyMap: Map<string, any> = new Map();

  constructor(config: AuthJwtConfig = {}) {
    this.config = {
      enabled: true,
      issuer: 'https://auth.geopulser.local',
      audience: 'geopulser-api',
      leewaySeconds: 30,
      publicRoutes: ['/', '/health', '/metrics'],
      ...config,
    };
    this.publicRoutesSet = new Set(this.config.publicRoutes);
    this.loadKeys();
  }

  init(config: Record<string, unknown>): void {
    if (config) {
      this.config = { ...this.config, ...config };
      if (this.config.publicRoutes) {
        this.publicRoutesSet = new Set(this.config.publicRoutes);
      }
      this.loadKeys();
    }
  }

  private loadKeys(): void {
    if (!this.config.jwks?.keys) return;
    for (const key of this.config.jwks.keys) {
      if (key.kty === 'RSA' && key.kid) {
        try {
          const pubKey = createPublicKey({
            key: {
              kty: key.kty,
              n: key.n,
              e: key.e,
            },
            format: 'jwk',
          });
          this.keyMap.set(key.kid, pubKey);
        } catch (err) {
          logger.error({ err, kid: key.kid }, 'Failed to parse JWK');
        }
      }
    }
  }

  private send401(ctx: RequestContext, code: string, message: string): void {
    metrics.recordError();
    metrics.recordAuthFailure();
    logger.warn({ requestId: ctx.requestId, code, message }, 'Auth failed');
    ctx.res.writeHead(401, { 'Content-Type': 'application/json' });
    ctx.res.end(
      JSON.stringify({
        error: {
          code,
          message,
        },
      })
    );
    ctx.responded = true;
  }

  preRoute(ctx: RequestContext): void {
    if (this.config.enabled === false) return;
    if (this.publicRoutesSet.has(ctx.path)) return;

    // Strip ALL inbound headers matching /^(x-auth-|x-user-|x-roles|x-scopes|x-email)/i
    for (const key of Object.keys(ctx.headers)) {
      if (/^(x-auth-|x-user-|x-roles|x-scopes|x-email)/i.test(key)) {
        delete ctx.headers[key];
      }
    }

    const authHeader = ctx.headers['authorization'];
    if (!authHeader || typeof authHeader !== 'string') {
      this.send401(ctx, 'unauthorized', 'Missing Authorization header');
      return;
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match || !match[1]) {
      this.send401(ctx, 'invalid_token', 'Invalid Bearer format');
      return;
    }

    const token = match[1].trim();
    const parts = token.split('.');
    if (parts.length !== 3) {
      this.send401(ctx, 'invalid_token', 'Malformed JWT');
      return;
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    let header: any;
    let payload: any;
    try {
      header = JSON.parse(Buffer.from(headerB64!, 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf8'));
    } catch {
      this.send401(ctx, 'invalid_token', 'Failed to parse JWT JSON');
      return;
    }

    if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') {
      this.send401(ctx, 'invalid_token', 'Invalid token structure');
      return;
    }

    if (header.alg !== 'RS256') {
      this.send401(ctx, 'invalid_algorithm', 'Only RS256 supported');
      return;
    }

    if (!header.kid) {
      this.send401(ctx, 'missing_kid', 'Missing key ID (kid)');
      return;
    }

    const publicKey = this.keyMap.get(header.kid);
    if (!publicKey) {
      this.send401(ctx, 'unknown_kid', `Unknown kid: ${header.kid}`);
      return;
    }

    // Verify signature
    const data = Buffer.from(`${headerB64}.${payloadB64}`);
    const sig = Buffer.from(signatureB64!, 'base64url');
    try {
      const valid = verify('RSA-SHA256', data, publicKey, sig);
      if (!valid) {
        this.send401(ctx, 'invalid_signature', 'Signature verification failed');
        return;
      }
    } catch {
      this.send401(ctx, 'invalid_signature', 'Signature verification error');
      return;
    }

    // Claims checks
    const nowSec = Math.floor(Date.now() / 1000);
    const leeway = this.config.leewaySeconds ?? 30;

    if (typeof payload.exp === 'number' && payload.exp + leeway < nowSec) {
      this.send401(ctx, 'token_expired', 'Token has expired');
      return;
    }

    if (this.config.issuer && payload.iss !== this.config.issuer) {
      this.send401(ctx, 'invalid_issuer', 'Issuer mismatch');
      return;
    }

    if (this.config.audience && payload.aud !== this.config.audience) {
      this.send401(ctx, 'invalid_audience', 'Audience mismatch');
      return;
    }

    // Safe logging (no token material)
    logger.info(
      {
        requestId: ctx.requestId,
        jti: payload.jti,
        sub: payload.sub,
        exp: payload.exp,
      },
      'Auth succeeded'
    );

    // Inject verified identity headers upstream
    if (payload.sub) ctx.headers['x-auth-user-id'] = String(payload.sub);
    if (payload.scopes || payload.scope) ctx.headers['x-auth-scopes'] = String(payload.scopes || payload.scope);
    if (payload.aud) ctx.headers['x-auth-aud'] = String(payload.aud);
    if (payload.jti) ctx.headers['x-auth-jti'] = String(payload.jti);
    if (payload.exp) ctx.headers['x-auth-exp'] = String(payload.exp);
    ctx.headers['x-auth-method'] = 'bearer_jwt';
  }
}
