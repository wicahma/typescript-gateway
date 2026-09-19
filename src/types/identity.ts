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

export interface WithIdentity extends GatewayConfig {
  apiKeys?: ApiKeysConfig;
}
