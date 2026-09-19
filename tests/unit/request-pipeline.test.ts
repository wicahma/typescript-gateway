import { describe, it, expect } from 'vitest';
import { createServer } from 'http';
import { ContextPool } from '../../src/core/context';
import { RequestPipeline } from '../../src/pipeline/request-pipeline';
import { GatewayPolicy, OutboundResponse } from '../../src/pipeline/policy';
import { RequestContext } from '../../src/types/core.js';

function createContext(): RequestContext {
  return new ContextPool(10).acquire();
}

function makeOutbound(): OutboundResponse {
  return {
    statusCode: 200,
    headers: { 'content-type': 'text/plain' },
    body: Buffer.from('hello'),
  };
}

class VoidInboundPolicy implements GatewayPolicy {
  readonly name: string;
  executed = false;

  constructor(name: string) {
    this.name = name;
  }

  executeInbound(ctx: RequestContext): void {
    void ctx;
    this.executed = true;
  }
}

class ShortCircuitPolicy implements GatewayPolicy {
  readonly name: string;

  constructor(
    name: string,
    private readonly response: Response,
  ) {
    this.name = name;
  }

  executeInbound(): Response {
    return this.response;
  }
}

class ThrowingInboundPolicy implements GatewayPolicy {
  readonly name = 'throwing-inbound';

  executeInbound(): void {
    throw new Error('inbound boom');
  }
}

class TransformPolicy implements GatewayPolicy {
  readonly name: string;
  executed = false;

  constructor(
    name: string,
    private readonly transform: (response: OutboundResponse) => OutboundResponse | void,
  ) {
    this.name = name;
  }

  executeOutbound(_ctx: RequestContext, response: OutboundResponse): OutboundResponse | void {
    void _ctx;
    this.executed = true;
    return this.transform(response);
  }
}

class ThrowingOutboundPolicy implements GatewayPolicy {
  readonly name = 'throwing-outbound';

  executeOutbound(): void {
    throw new Error('outbound boom');
  }
}

describe('RequestPipeline', () => {
  describe('register', () => {
    it('appends policies in order', async () => {
      const a = new VoidInboundPolicy('a');
      const b = new VoidInboundPolicy('b');
      const pipeline = new RequestPipeline([a]);
      pipeline.register(b);
      expect(await pipeline.runInbound(createContext())).toBeNull();
      expect(a.executed).toBe(true);
      expect(b.executed).toBe(true);
    });

    it('rejects duplicate policy name on register', () => {
      const pipeline = new RequestPipeline([new VoidInboundPolicy('dup')]);
      expect(() => pipeline.register(new VoidInboundPolicy('dup'))).toThrow(/duplicate/i);
    });

    it('rejects duplicate policy name passed via constructor', () => {
      expect(() => new RequestPipeline([new VoidInboundPolicy('dup'), new VoidInboundPolicy('dup')])).toThrow(
        /duplicate/i,
      );
    });
  });

  describe('runInbound', () => {
    it('returns null when there are no policies', async () => {
      const pipeline = new RequestPipeline([]);
      expect(await pipeline.runInbound(createContext())).toBeNull();
    });

    it('returns null when all policies return void', async () => {
      const pipeline = new RequestPipeline([new VoidInboundPolicy('v1'), new VoidInboundPolicy('v2')]);
      expect(await pipeline.runInbound(createContext())).toBeNull();
    });

    it('short-circuits on first Response and does not execute later policies', async () => {
      const early = new ShortCircuitPolicy('early', new Response('blocked', { status: 403 }));
      const late = new VoidInboundPolicy('late');
      const pipeline = new RequestPipeline([early, late]);
      const result = await pipeline.runInbound(createContext());
      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(403);
      expect(await result?.text()).toBe('blocked');
      expect(late.executed).toBe(false);
    });

    it('preserves ordering via side-effect counter', async () => {
      const order: string[] = [];
      class CountingPolicy implements GatewayPolicy {
        readonly name: string;
        constructor(name: string) {
          this.name = name;
        }
        executeInbound(): void {
          order.push(this.name);
        }
      }
      const pipeline = new RequestPipeline([new CountingPolicy('one'), new CountingPolicy('two'), new CountingPolicy('three')]);
      await pipeline.runInbound(createContext());
      expect(order).toEqual(['one', 'two', 'three']);
    });

    it('skips policies without executeInbound', async () => {
      class OutboundOnlyPolicy implements GatewayPolicy {
        readonly name = 'outbound-only';
        executeOutbound(_ctx: RequestContext, response: OutboundResponse): OutboundResponse {
          void _ctx;
          return response;
        }
      }
      const pipeline = new RequestPipeline([new OutboundOnlyPolicy()]);
      expect(await pipeline.runInbound(createContext())).toBeNull();
    });

    it('propagates throwing policy', async () => {
      const pipeline = new RequestPipeline([new VoidInboundPolicy('first'), new ThrowingInboundPolicy()]);
      await expect(pipeline.runInbound(createContext())).rejects.toThrow('inbound boom');
    });
  });

  describe('runOutbound', () => {
    it('composes a chain of transformations', async () => {
      const statusPolicy = new TransformPolicy('status', (r) => ({ ...r, statusCode: 201 }));
      const headerPolicy = new TransformPolicy('header', (r) => ({
        ...r,
        headers: { ...r.headers, 'x-trace': 'abc' },
      }));
      const bodyPolicy = new TransformPolicy('body', (r) => ({ ...r, body: Buffer.from('transformed') }));
      const pipeline = new RequestPipeline([statusPolicy, headerPolicy, bodyPolicy]);
      const result = await pipeline.runOutbound(createContext(), makeOutbound());
      expect(result.statusCode).toBe(201);
      expect(result.headers).toEqual({ 'content-type': 'text/plain', 'x-trace': 'abc' });
      expect(result.body?.toString()).toBe('transformed');
      expect(statusPolicy.executed).toBe(true);
      expect(headerPolicy.executed).toBe(true);
      expect(bodyPolicy.executed).toBe(true);
    });

    it('keeps previous response when a policy returns void', async () => {
      const voidPolicy = new TransformPolicy('void-keeper', () => undefined);
      const pipeline = new RequestPipeline([voidPolicy]);
      const original = makeOutbound();
      const result = await pipeline.runOutbound(createContext(), original);
      expect(result).toBe(original);
      expect(result.statusCode).toBe(200);
    });

    it('preserves ordering', async () => {
      const order: string[] = [];
      class CountingOutboundPolicy implements GatewayPolicy {
        readonly name: string;
        constructor(name: string) {
          this.name = name;
        }
        executeOutbound(_ctx: RequestContext, response: OutboundResponse): OutboundResponse {
          void _ctx;
          order.push(this.name);
          return response;
        }
      }
      const pipeline = new RequestPipeline([
        new CountingOutboundPolicy('one'),
        new CountingOutboundPolicy('two'),
      ]);
      await pipeline.runOutbound(createContext(), makeOutbound());
      expect(order).toEqual(['one', 'two']);
    });

    it('returns unchanged response when no policies', async () => {
      const pipeline = new RequestPipeline([]);
      const original = makeOutbound();
      expect(await pipeline.runOutbound(createContext(), original)).toBe(original);
    });

    it('propagates throwing policy', async () => {
      const pipeline = new RequestPipeline([new ThrowingOutboundPolicy()]);
      await expect(pipeline.runOutbound(createContext(), makeOutbound())).rejects.toThrow('outbound boom');
    });
  });

  describe('writeResponse', () => {
    it('writes status, headers and body to a real ServerResponse', async () => {
      const server = createServer((_req, res) => {
        void _req;
        const webResponse = new Response('short-circuit body', {
          status: 418,
          headers: { 'x-gateway': 'test', 'content-type': 'text/plain' },
        });
        void RequestPipeline.writeResponse(res, webResponse);
      });
      const port = await new Promise<number>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          resolve((server.address() as { port: number }).port);
        });
      });
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' });
        expect(res.status).toBe(418);
        expect(res.headers.get('x-gateway')).toBe('test');
        expect(res.headers.get('content-type')).toBe('text/plain');
        expect(await res.text()).toBe('short-circuit body');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});
