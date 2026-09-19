import { OutgoingHttpHeaders } from 'node:http';
import { RequestContext } from '../types/core.js';

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