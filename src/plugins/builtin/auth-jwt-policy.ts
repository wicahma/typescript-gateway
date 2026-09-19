import { createPublicKey, verify } from 'crypto';
import { GatewayPolicy } from '../../pipeline/policy.js';
import { RequestContext } from '../../types/core.js';
import { logger } from '../../utils/logger.js';
import { metrics } from '../../utils/metrics.js';
import { HttpProblems } from '../../pipeline/http-problems.js';

interface JWK {
  kty: string;
  n: string;
  e: string;
  kid?: string;
  alg?: string;
  use?: string;
}

export interface AuthJwtPolicyConfig {
  enabled?: boolean;
  issuer?: string;
  audience?: string;
  jwks?: { keys: JWK[] };
  leewaySeconds?: number;
  publicRoutes?: string[];
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface JwtClaims {
  sub?: string;
  iss?: string;
  aud?: string;
  exp?: number;
  jti?: string;
  scopes?: string;
  scope?: string;
}

type VerifyResult = JwtClaims | { claim: string; message: string };

export class AuthJwtPolicy implements GatewayPolicy {
  readonly name = 'auth-jwt';

  private publicRoutes: Set<string>;
  private keyMap = new Map<string, ReturnType<typeof createPublicKey>>();

  constructor(private config: AuthJwtPolicyConfig = {}) {
    this.publicRoutes = new Set(this.config.publicRoutes ?? ['/', '/health', '/metrics']);
    this.loadKeys();
  }

  private loadKeys(): void {
    for (const key of this.config.jwks?.keys ?? []) {
      if (!key.kid || key.kty !== 'RSA') continue;
      try {
        this.keyMap.set(key.kid, createPublicKey({ key: key as never, format: 'jwk' }));
      } catch (error) {
        logger.warn({ kid: key.kid, error: String(error) }, 'Skipping invalid JWKS key');
      }
    }
  }

  executeInbound(ctx: RequestContext): Response | void {
    if (this.config.enabled === false) return;
    if (this.publicRoutes.has(ctx.path)) return;
    this.stripIdentityHeaders(ctx.headers);

    const token = this.extractBearerToken(ctx.headers);
    if (!token) return this.reject(ctx, 'unauthorized', 'Missing or malformed Authorization header');

    const result = this.verifyToken(token);
    if ('claim' in result) return this.reject(ctx, result.claim, result.message);

    this.injectIdentity(ctx, result);
  }

  private stripIdentityHeaders(headers: RequestContext['headers']): void {
    for (const key of Object.keys(headers)) {
      if (/^(x-auth-|x-user-|x-roles|x-scopes|x-email)/i.test(key)) delete headers[key];
    }
  }

  private extractBearerToken(headers: RequestContext['headers']): string | null {
    const auth = headers['authorization'];
    if (!auth || typeof auth !== 'string') return null;
    const match = auth.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() ?? null;
  }

  private verifyToken(token: string): VerifyResult {
    const parts = token.split('.');
    if (parts.length !== 3) return { claim: 'invalid_token', message: 'Malformed JWT' };
    const [headerB64, payloadB64, signatureB64] = parts;

    let header: JwtHeader;
    let claims: JwtClaims;
    try {
      header = JSON.parse(Buffer.from(headerB64!, 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf8'));
    } catch {
      return { claim: 'invalid_token', message: 'Failed to parse JWT' };
    }
    if (!header || typeof header !== 'object' || !claims || typeof claims !== 'object') {
      return { claim: 'invalid_token', message: 'Invalid token structure' };
    }
    if (header.alg !== 'RS256') return { claim: 'invalid_algorithm', message: 'Only RS256 supported' };
    if (!header.kid) return { claim: 'missing_kid', message: 'Missing key ID (kid)' };

    const publicKey = this.keyMap.get(header.kid);
    if (!publicKey) return { claim: 'unknown_kid', message: `Unknown kid: ${header.kid}` };

    try {
      const valid = verify('RSA-SHA256', Buffer.from(`${headerB64}.${payloadB64}`), publicKey, Buffer.from(signatureB64!, 'base64url'));
      if (!valid) return { claim: 'invalid_signature', message: 'Signature verification failed' };
    } catch {
      return { claim: 'invalid_signature', message: 'Signature verification error' };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof claims.exp === 'number' && claims.exp + (this.config.leewaySeconds ?? 30) < nowSec) {
      return { claim: 'token_expired', message: 'Token has expired' };
    }
    if (this.config.issuer && claims.iss !== this.config.issuer) {
      return { claim: 'invalid_issuer', message: 'Issuer mismatch' };
    }
    if (this.config.audience && claims.aud !== this.config.audience) {
      return { claim: 'invalid_audience', message: 'Audience mismatch' };
    }
    return claims;
  }

  private injectIdentity(ctx: RequestContext, claims: JwtClaims): void {
    if (claims.sub) ctx.headers['x-auth-user-id'] = String(claims.sub);
    if (claims.scopes || claims.scope) ctx.headers['x-auth-scopes'] = String(claims.scopes || claims.scope);
    if (claims.aud) ctx.headers['x-auth-aud'] = String(claims.aud);
    if (claims.jti) ctx.headers['x-auth-jti'] = String(claims.jti);
    if (claims.exp) ctx.headers['x-auth-exp'] = String(claims.exp);
    ctx.headers['x-auth-method'] = 'bearer_jwt';
    ctx.state['user'] = { sub: claims.sub, jti: claims.jti, exp: claims.exp };
    logger.info({ requestId: ctx.requestId, sub: claims.sub, jti: claims.jti }, 'Auth succeeded');
  }

  private reject(ctx: RequestContext, code: string, message: string): Response {
    metrics.recordError();
    logger.warn({ requestId: ctx.requestId, code, message }, 'Auth failed');
    return HttpProblems.unauthorized(message, { requestId: ctx.requestId });
  }
}
