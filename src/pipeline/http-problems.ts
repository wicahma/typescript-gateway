export interface ProblemFields {
  detail?: string;
  instance?: string;
  requestId?: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  requestId?: string;
}

const TYPE_BASE = 'https://gateway.internal/errors';

const CATALOG: Record<string, { status: number; title: string; slug: string }> = {
  'bad-request': { status: 400, title: 'Bad Request', slug: 'bad-request' },
  unauthorized: { status: 401, title: 'Unauthorized', slug: 'unauthorized' },
  forbidden: { status: 403, title: 'Forbidden', slug: 'forbidden' },
  'not-found': { status: 404, title: 'Not Found', slug: 'not-found' },
  'payload-too-large': { status: 413, title: 'Payload Too Large', slug: 'payload-too-large' },
  'rate-limit-exceeded': { status: 429, title: 'Too Many Requests', slug: 'rate-limit-exceeded' },
  'internal-error': { status: 500, title: 'Internal Server Error', slug: 'internal-error' },
  'bad-gateway': { status: 502, title: 'Bad Gateway', slug: 'bad-gateway' },
  'service-unavailable': { status: 503, title: 'Service Unavailable', slug: 'service-unavailable' },
  'gateway-timeout': { status: 504, title: 'Gateway Timeout', slug: 'gateway-timeout' },
};

function toResponse(problem: ProblemDetails, headers: Record<string, string> = {}): Response {
  return new Response(problemToJson(problem), {
    status: problem.status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });
}

export function createProblem(code: string, fields: ProblemFields = {}): Response {
  const entry = CATALOG[code];
  if (!entry) {
    throw new Error(`ERR_UNKNOWN_PROBLEM_SLUG: ${code}`);
  }
  if (entry.status < 400 || entry.status > 599) {
    throw new Error('ERR_PROBLEM_STATUS');
  }
  const problem: ProblemDetails = {
    type: `${TYPE_BASE}/${entry.slug}`,
    title: entry.title,
    status: entry.status,
  };
  if (fields.detail !== undefined) problem.detail = fields.detail;
  if (fields.instance !== undefined) problem.instance = fields.instance;
  if (fields.requestId !== undefined) problem.requestId = fields.requestId;
  return toResponse(problem);
}

export function problemToJson(problem: ProblemDetails): string {
  const out: ProblemDetails = {
    type: problem.type,
    title: problem.title,
    status: problem.status,
  };
  if (problem.detail !== undefined) out.detail = problem.detail;
  if (problem.instance !== undefined) out.instance = problem.instance;
  if (problem.requestId !== undefined) out.requestId = problem.requestId;
  return JSON.stringify(out);
}

export const HttpProblems = {
  badRequest: (detail?: string, extra?: ProblemFields) =>
    createProblem('bad-request', { detail, ...extra }),
  unauthorized: (detail?: string, extra?: ProblemFields) =>
    createProblem('unauthorized', { detail, ...extra }),
  forbidden: (detail?: string, extra?: ProblemFields) =>
    createProblem('forbidden', { detail, ...extra }),
  notFound: (detail?: string, extra?: ProblemFields) =>
    createProblem('not-found', { detail, ...extra }),
  payloadTooLarge: (detail?: string, extra?: ProblemFields) =>
    createProblem('payload-too-large', { detail, ...extra }),
  rateLimited: ({
    detail,
    limit,
    window,
    retryAfterSeconds,
    ...extra
  }: {
    detail?: string;
    limit?: number;
    window?: string;
    retryAfterSeconds?: number;
  } & ProblemFields): Response => {
    const text =
      detail ??
      (limit !== undefined && window !== undefined && retryAfterSeconds !== undefined
        ? `Rate limit of ${limit} requests per ${window} exceeded. Try again in ${retryAfterSeconds} seconds.`
        : undefined);
    const res = createProblem('rate-limit-exceeded', { detail: text, ...extra });
    if (retryAfterSeconds !== undefined) {
      res.headers.set('retry-after', String(retryAfterSeconds));
    }
    return res;
  },
  internal: (detail?: string, extra?: ProblemFields) =>
    createProblem('internal-error', { detail, ...extra }),
  badGateway: (detail?: string, extra?: ProblemFields) =>
    createProblem('bad-gateway', { detail, ...extra }),
  serviceUnavailable: (detail?: string, extra?: ProblemFields) =>
    createProblem('service-unavailable', { detail, ...extra }),
  gatewayTimeout: (detail?: string, extra?: ProblemFields) =>
    createProblem('gateway-timeout', { detail, ...extra }),
};
