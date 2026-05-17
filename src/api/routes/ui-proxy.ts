import type { FastifyInstance, FastifyReply } from 'fastify';
import { circuitBreakerRegistry } from '../../resilience/circuit-breaker.js';
import { logger } from '../../observability/logger.js';

type Rail = 'PIX' | 'SPEI' | 'BRE_B';

/**
 * P06 — Circuit breakers per rail-adapter HTTP call. Was previously dead
 * code (`execute` never invoked). Uses the shared CircuitBreakerRegistry so
 * the `/analytics/circuit-breakers` endpoint surfaces their state.
 */
const BREAKER_OPTS = { failureThreshold: 5, cooldownMs: 30_000, windowMs: 60_000 };

async function fetchWithBreaker(rail: string, url: string, init?: RequestInit): Promise<Response> {
  const breaker = circuitBreakerRegistry.get(`adapter-${rail.toLowerCase()}-http`, BREAKER_OPTS);
  try {
    return await breaker.execute(() => fetch(url, init));
  } catch (err) {
    logger.warn({ rail, url, err: String(err) }, 'ui-proxy fetch blocked by circuit breaker');
    throw err;
  }
}

type RailTargets = {
  healthUrl: string;
  mockBaseUrl: string;
};

const DEFAULT_RAIL_TARGETS: Record<Rail, RailTargets> = {
  PIX: {
    healthUrl: 'http://adapter-pix:9101/health',
    mockBaseUrl: 'http://adapter-pix:9001',
  },
  SPEI: {
    healthUrl: 'http://adapter-spei:9102/health',
    mockBaseUrl: 'http://adapter-spei:9002',
  },
  BRE_B: {
    healthUrl: 'http://adapter-breb:9103/health',
    mockBaseUrl: 'http://adapter-breb:9003',
  },
};

function getRailTargets(rail: string): RailTargets {
  const key = rail.toUpperCase() as Rail;
  const envMap: Record<Rail, RailTargets> = {
    PIX: {
      healthUrl: process.env.UI_PROXY_PIX_HEALTH_URL ?? DEFAULT_RAIL_TARGETS.PIX.healthUrl,
      mockBaseUrl: process.env.UI_PROXY_PIX_MOCK_BASE_URL ?? DEFAULT_RAIL_TARGETS.PIX.mockBaseUrl,
    },
    SPEI: {
      healthUrl: process.env.UI_PROXY_SPEI_HEALTH_URL ?? DEFAULT_RAIL_TARGETS.SPEI.healthUrl,
      mockBaseUrl: process.env.UI_PROXY_SPEI_MOCK_BASE_URL ?? DEFAULT_RAIL_TARGETS.SPEI.mockBaseUrl,
    },
    BRE_B: {
      healthUrl: process.env.UI_PROXY_BREB_HEALTH_URL ?? DEFAULT_RAIL_TARGETS.BRE_B.healthUrl,
      mockBaseUrl: process.env.UI_PROXY_BREB_MOCK_BASE_URL ?? DEFAULT_RAIL_TARGETS.BRE_B.mockBaseUrl,
    },
  };

  const targets = envMap[key];
  if (!targets) {
    throw new Error(`Unsupported rail: ${rail}`);
  }

  if (!targets.healthUrl || !targets.mockBaseUrl) {
    throw new Error(`UI proxy target is not configured for rail: ${rail}`);
  }

  return targets;
}

async function sendUpstream(reply: FastifyReply, upstream: Response) {
  const raw = await upstream.text();

  let body: unknown = raw;
  const contentType = upstream.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = { raw };
    }
  }

  return reply.status(upstream.status).send(body);
}

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/$/, '')}${path}`;
}

export async function registerUiProxyRoutes(app: FastifyInstance) {
  app.get<{ Params: { rail: string } }>(
    '/services/:rail/health',
    async (req, reply) => {
      try {
        const targets = getRailTargets(req.params.rail);
        const upstream = await fetchWithBreaker(req.params.rail, targets.healthUrl);
        return sendUpstream(reply, upstream);
      } catch (error) {
        req.log.warn({ err: error, rail: req.params.rail }, 'UI proxy health request failed');
        return reply.status(502).send({
          code: 'UPSTREAM_UNAVAILABLE',
          message: error instanceof Error ? error.message : 'Failed to reach upstream health endpoint',
        });
      }
    },
  );

  app.get<{ Params: { rail: string } }>(
    '/mocks/:rail/health',
    async (req, reply) => {
      try {
        const targets = getRailTargets(req.params.rail);
        const upstream = await fetchWithBreaker(req.params.rail, joinUrl(targets.mockBaseUrl, '/health'));
        return sendUpstream(reply, upstream);
      } catch (error) {
        req.log.warn({ err: error, rail: req.params.rail }, 'UI proxy mock health request failed');
        return reply.status(502).send({
          code: 'UPSTREAM_UNAVAILABLE',
          message: error instanceof Error ? error.message : 'Failed to reach mock health endpoint',
        });
      }
    },
  );

  app.get<{ Params: { rail: string } }>(
    '/mocks/:rail/admin/stats',
    async (req, reply) => {
      try {
        const targets = getRailTargets(req.params.rail);
        const upstream = await fetchWithBreaker(req.params.rail, joinUrl(targets.mockBaseUrl, '/admin/stats'));
        return sendUpstream(reply, upstream);
      } catch (error) {
        req.log.warn({ err: error, rail: req.params.rail }, 'UI proxy mock stats request failed');
        return reply.status(502).send({
          code: 'UPSTREAM_UNAVAILABLE',
          message: error instanceof Error ? error.message : 'Failed to reach mock stats endpoint',
        });
      }
    },
  );

  app.get<{ Params: { rail: string } }>(
    '/mocks/:rail/admin/config',
    async (req, reply) => {
      try {
        const targets = getRailTargets(req.params.rail);
        const upstream = await fetchWithBreaker(req.params.rail, joinUrl(targets.mockBaseUrl, '/admin/config'));
        return sendUpstream(reply, upstream);
      } catch (error) {
        req.log.warn({ err: error, rail: req.params.rail }, 'UI proxy mock config request failed');
        return reply.status(502).send({
          code: 'UPSTREAM_UNAVAILABLE',
          message: error instanceof Error ? error.message : 'Failed to reach mock config endpoint',
        });
      }
    },
  );

  app.post<{ Params: { rail: string }; Body: Record<string, unknown> }>(
    '/mocks/:rail/admin/config',
    async (req, reply) => {
      try {
        const targets = getRailTargets(req.params.rail);
        const upstream = await fetchWithBreaker(req.params.rail, joinUrl(targets.mockBaseUrl, '/admin/config'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body ?? {}),
        });
        return sendUpstream(reply, upstream);
      } catch (error) {
        req.log.warn({ err: error, rail: req.params.rail }, 'UI proxy mock config update failed');
        return reply.status(502).send({
          code: 'UPSTREAM_UNAVAILABLE',
          message: error instanceof Error ? error.message : 'Failed to update mock config endpoint',
        });
      }
    },
  );

  for (const action of ['reject-next', 'timeout-next', 'reset'] as const) {
    app.post<{ Params: { rail: string } }>(`/mocks/:rail/admin/${action}`, async (req, reply) => {
      try {
        const targets = getRailTargets(req.params.rail);
        const upstream = await fetchWithBreaker(req.params.rail, joinUrl(targets.mockBaseUrl, `/admin/${action}`), {
          method: 'POST',
        });
        return sendUpstream(reply, upstream);
      } catch (error) {
        req.log.warn({ err: error, rail: req.params.rail, action }, 'UI proxy mock action failed');
        return reply.status(502).send({
          code: 'UPSTREAM_UNAVAILABLE',
          message: error instanceof Error ? error.message : `Failed to reach mock action endpoint: ${action}`,
        });
      }
    });
  }
}
