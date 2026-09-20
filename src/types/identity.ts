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
}
