import { GatewayConfig } from './core.js';

export interface ApiKeysConfig {
  enabled?: boolean;
  publicRoutes?: string[];
  headerName?: string;
  cacheTtlSeconds?: number;
  cacheMaxEntries?: number;
  consumers: Array<{
    consumerId: string;
    plan: string;
    rateLimit: number;
    dailyLimit?: number;
    keys: Array<{ key: string; expiresAt?: number }>;
  }>;
}

export interface UpstreamCredentialsConfig {
  enabled?: boolean;
  credentials: Array<{
    name: string;
    headers?: Record<string, string>;
    hmac?: { secret: string; keyId?: string; headerNamespace?: string };
  }>;
  injection?: { credentialName: string; publicRoutes?: string[] };
  signing?: { credentialName: string; publicRoutes?: string[] };
}

export interface WithIdentity extends GatewayConfig {
  apiKeys?: ApiKeysConfig;
  upstreamCredentials?: UpstreamCredentialsConfig;
  cors?: {
    enabled?: boolean;
    allowOrigins?: string[];
    allowMethods?: string[];
    allowHeaders?: string[];
    allowCredentials?: boolean;
    maxAgeSeconds?: number;
  };
  idempotency?: { enabled?: boolean; ttlMs?: number; maxEntries?: number };
  secretMask?: { enabled?: boolean; replacement?: string };
  traceContext?: { enabled?: boolean };
  loadShedding?: { enabled?: boolean; min?: number; max?: number; targetP95Ms?: number };
}
