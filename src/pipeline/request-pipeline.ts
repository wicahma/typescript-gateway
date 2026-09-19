import { ServerResponse } from 'node:http';
import { RequestContext } from '../types/core.js';
import { GatewayPolicy, OutboundResponse } from './policy.js';

export class RequestPipeline {
  private readonly policies: GatewayPolicy[];

  constructor(policies: GatewayPolicy[] = []) {
    this.policies = [];
    for (const policy of policies) {
      this.register(policy);
    }
  }

  register(policy: GatewayPolicy): void {
    if (this.policies.some((existing) => existing.name === policy.name)) {
      throw new Error(`Duplicate policy name: ${policy.name}`);
    }
    this.policies.push(policy);
  }

  async runInbound(ctx: RequestContext): Promise<Response | null> {
    for (const policy of this.policies) {
      if (!policy.executeInbound) {
        continue;
      }
      const response = await policy.executeInbound(ctx);
      if (response) {
        return response;
      }
    }
    return null;
  }

  async runOutbound(ctx: RequestContext, response: OutboundResponse): Promise<OutboundResponse> {
    let current = response;
    for (const policy of this.policies) {
      if (!policy.executeOutbound) {
        continue;
      }
      const next = await policy.executeOutbound(ctx, current);
      if (next) {
        current = next;
      }
    }
    return current;
  }

  static async writeResponse(res: ServerResponse, response: Response): Promise<void> {
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    res.end(buffer);
  }
}