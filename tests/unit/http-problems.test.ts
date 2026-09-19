import { describe, it, expect } from 'vitest';
import {
  HttpProblems,
  createProblem,
  problemToJson,
} from '../../src/pipeline/http-problems.js';

const TYPE_BASE = 'https://gateway.internal/errors';

async function parseBody(res: Response) {
  return JSON.parse(await res.text());
}

describe('HttpProblems helpers', () => {
  it('badRequest returns 400 Response with bad-request type', async () => {
    const res = HttpProblems.badRequest('Invalid cursor');

    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const body = await parseBody(res);
    expect(body.type).toBe(`${TYPE_BASE}/bad-request`);
    expect(body.title).toBe('Bad Request');
    expect(body.status).toBe(400);
    expect(body.detail).toBe('Invalid cursor');
  });

  it('unauthorized returns 401 Response with unauthorized type', async () => {
    const res = HttpProblems.unauthorized();

    expect(res.status).toBe(401);
    const body = await parseBody(res);
    expect(body.type).toBe(`${TYPE_BASE}/unauthorized`);
    expect(body.title).toBe('Unauthorized');
  });

  it('forbidden returns 403 Response with forbidden type', async () => {
    const res = HttpProblems.forbidden();

    expect(res.status).toBe(403);
    const body = await parseBody(res);
    expect(body.type).toBe(`${TYPE_BASE}/forbidden`);
    expect(body.title).toBe('Forbidden');
  });

  it('notFound returns 404 Response with not-found type', async () => {
    const res = HttpProblems.notFound();

    expect(res.status).toBe(404);
    const body = await parseBody(res);
    expect(body.type).toBe(`${TYPE_BASE}/not-found`);
    expect(body.title).toBe('Not Found');
  });

  it('payloadTooLarge returns 413 Response with payload-too-large type', async () => {
    const res = HttpProblems.payloadTooLarge('Body exceeds 1 MiB');

    expect(res.status).toBe(413);
    const body = await parseBody(res);
    expect(body.type).toBe(`${TYPE_BASE}/payload-too-large`);
    expect(body.title).toBe('Payload Too Large');
    expect(body.detail).toBe('Body exceeds 1 MiB');
  });

  it('internal returns 500 Response with internal-error type', async () => {
    const res = HttpProblems.internal();

    expect(res.status).toBe(500);
    const body = await parseBody(res);
    expect(body.type).toBe(`${TYPE_BASE}/internal-error`);
    expect(body.title).toBe('Internal Server Error');
  });

  it('badGateway returns 502 Response with bad-gateway type', async () => {
    const res = HttpProblems.badGateway();

    expect(res.status).toBe(502);
    const body = await parseBody(res);
    expect(body.type).toBe(`${TYPE_BASE}/bad-gateway`);
    expect(body.title).toBe('Bad Gateway');
  });

  it('serviceUnavailable returns 503 Response with service-unavailable type', async () => {
    const res = HttpProblems.serviceUnavailable();

    expect(res.status).toBe(503);
    const body = await parseBody(res);
    expect(body.type).toBe(`${TYPE_BASE}/service-unavailable`);
    expect(body.title).toBe('Service Unavailable');
  });

  it('gatewayTimeout returns 504 Response with gateway-timeout type', async () => {
    const res = HttpProblems.gatewayTimeout();

    expect(res.status).toBe(504);
    const body = await parseBody(res);
    expect(body.type).toBe(`${TYPE_BASE}/gateway-timeout`);
    expect(body.title).toBe('Gateway Timeout');
  });
});

describe('HttpProblems.rateLimited', () => {
  it('returns 429 with rate-limit-exceeded type and Too Many Requests title', async () => {
    const res = HttpProblems.rateLimited({ limit: 100, window: 'minute', retryAfterSeconds: 24 });

    expect(res.status).toBe(429);
    const body = await parseBody(res);
    expect(body.type).toBe(`${TYPE_BASE}/rate-limit-exceeded`);
    expect(body.title).toBe('Too Many Requests');
  });

  it('includes Retry-After header matching retryAfterSeconds', () => {
    const res = HttpProblems.rateLimited({ limit: 100, window: 'minute', retryAfterSeconds: 24 });

    expect(res.headers.get('retry-after')).toBe('24');
  });

  it('formats detail with limit, window and retry seconds', async () => {
    const res = HttpProblems.rateLimited({ limit: 100, window: 'minute', retryAfterSeconds: 24 });

    const body = await parseBody(res);
    expect(body.detail).toBe(
      'Rate limit of 100 requests per minute exceeded. Try again in 24 seconds.'
    );
  });

  it('uses custom detail string when quota fields absent', async () => {
    const res = HttpProblems.rateLimited({ detail: 'Slow down' });

    const body = await parseBody(res);
    expect(body.detail).toBe('Slow down');
    expect(res.headers.get('retry-after')).toBeNull();
  });
});

describe('optional field omission', () => {
  it('omits detail, instance and requestId when absent', async () => {
    const res = HttpProblems.notFound();
    const raw = await res.text();
    const body = JSON.parse(raw);

    expect('detail' in body).toBe(false);
    expect('instance' in body).toBe(false);
    expect('requestId' in body).toBe(false);
    expect(raw).not.toContain('null');
  });

  it('includes instance and requestId when provided', async () => {
    const res = HttpProblems.notFound('No route', {
      instance: '/v1/orders/123',
      requestId: 'req_01HXYZ',
    });

    const body = await parseBody(res);
    expect(body.instance).toBe('/v1/orders/123');
    expect(body.requestId).toBe('req_01HXYZ');
  });
});

describe('createProblem', () => {
  it('builds a Response from a catalog code with fields', async () => {
    const res = createProblem('unauthorized', { detail: 'Token expired' });

    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const body = await parseBody(res);
    expect(body.type).toBe(`${TYPE_BASE}/unauthorized`);
    expect(body.detail).toBe('Token expired');
  });

  it('accepts no fields', async () => {
    const res = createProblem('gateway-timeout');

    expect(res.status).toBe(504);
  });
});

describe('problemToJson', () => {
  it('returns parseable problem JSON string', async () => {
    const res = HttpProblems.badRequest('oops');
    const body = await parseBody(res);

    const json = problemToJson({ type: body.type, title: body.title, status: body.status, detail: 'oops' });
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe(body.type);
    expect(parsed.status).toBe(400);
  });
});
