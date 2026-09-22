import { OutgoingHttpHeaders } from 'node:http';
import { RequestContext } from '../types/core.js';
import { Plugin } from '../types/plugin.js';

export interface OutboundResponse {
  statusCode: number;
  headers: OutgoingHttpHeaders;
  body?: Buffer;
}

export interface GatewayPolicy {
  readonly name: string;
  executeInbound?(ctx: RequestContext): Promise<Response | void> | Response | void;
  executeOutbound?(
    ctx: RequestContext,
    response: OutboundResponse,
  ): Promise<OutboundResponse | void> | OutboundResponse | void;
}

export class PluginPolicy implements GatewayPolicy {
  readonly name: string;
  private readonly plugin: Plugin;
  private readonly initConfig: Record<string, unknown>;

  constructor(plugin: Plugin, config: Record<string, unknown> = {}) {
    this.plugin = plugin;
    this.initConfig = config;
    this.name = `plugin:${plugin.name}`;
  }

  async executeInbound(ctx: RequestContext): Promise<Response | void> {
    if (this.plugin.preRoute) await this.plugin.preRoute(ctx);
    if (this.plugin.preHandler) await this.plugin.preHandler(ctx);
    if (ctx.responded) {
      return new Response(null, { status: 204 });
    }
  }

  async executeOutbound(
    ctx: RequestContext,
    response: OutboundResponse,
  ): Promise<OutboundResponse | void> {
    if (this.plugin.postHandler) await this.plugin.postHandler(ctx);
    if (this.plugin.postResponse) await this.plugin.postResponse(ctx);
    const extra = ctx.state['pluginHeaders'] as Record<string, string> | undefined;
    if (extra) {
      response.headers = { ...response.headers, ...extra };
      delete ctx.state['pluginHeaders'];
    }
    return response;
  }

  getPlugin(): Plugin {
    return this.plugin;
  }

  getConfig(): Record<string, unknown> {
    return this.initConfig;
  }
}

export function isPlugin(value: unknown): value is Plugin {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Plugin).name === 'string' &&
    typeof (value as Plugin).version === 'string' &&
    typeof (value as Plugin).description === 'string'
  );
}