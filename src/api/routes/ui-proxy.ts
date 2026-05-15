import type { FastifyInstance, FastifyReply } from 'fastify';

type Rail = 'PIX' | 'SPEI' | 'BRE_B';

type RailTargets = {
  healthUrl: string;
  mockBaseUrl: string;
};

function getRailTargets(rail: string): RailTargets {
  const key = rail.toUpperCase() as Rail;
  const envMap: Record<Rail, RailTargets> = {
    PIX: {
      healthUrl: process.env.UI_PROXY_PIX_HEALTH_URL ?? '',
      mockBaseUrl: process.env.UI_PROXY_PIX_MOCK_BASE_URL ?? '',
    },
    SPEI: {
      healthUrl: process.env.UI_PROXY_SPEI_HEALTH_URL ?? '',
      mockBaseUrl: process.env.UI_PROXY_SPEI_MOCK_BASE_URL ?? '',
    },
    BRE_B: {
      healthUrl: process.env.UI_PROXY_BREB_HEALTH_URL ?? '',
      mockBaseUrl: process.env.UI_PROXY_BREB_MOCK_BASE_URL ?? '',
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
        const upstream = await fetch(targets.healthUrl);
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
        const upstream = await fetch(joinUrl(targets.mockBaseUrl, '/health'));
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
        const upstream = await fetch(joinUrl(targets.mockBaseUrl, '/admin/stats'));
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
        const upstream = await fetch(joinUrl(targets.mockBaseUrl, '/admin/config'));
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
        const upstream = await fetch(joinUrl(targets.mockBaseUrl, '/admin/config'), {
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
        const upstream = await fetch(joinUrl(targets.mockBaseUrl, `/admin/${action}`), {
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
