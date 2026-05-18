import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import type { Pool } from 'pg';
import type { Channel } from 'amqplib';
import { paymentRoutes } from './routes/payments.js';
import { healthRoutes } from './routes/health.js';
import { metricsRoutes } from './routes/metrics.js';
import { translateRoutes } from './routes/translate.js';
import { registerSseRoutes } from './routes/sse.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerAnalyticsRoutes } from './routes/analytics.js';
import { registerUiProxyRoutes } from './routes/ui-proxy.js';
import type { Translator } from '../translation/translator.js';
import type { MappingLoader } from '../translation/mapping-loader.js';
import { errorHandler } from './middleware/error-handler.js';
import { tracingMiddleware } from './middleware/tracing.js';
import { authMiddleware } from './middleware/auth.js';
import { registerRateLimitMiddleware } from './middleware/rate-limit.js';
import { registerSanitizationMiddleware } from './middleware/sanitize.js';
import { logger } from '../observability/logger.js';
import { env } from '../config/env.js';
import type { PaymentPipeline } from '../pipeline/payment-pipeline.js';
import type { PaymentRepository } from '../persistence/repositories/payment.repository.js';
import type { AuditRepository } from '../persistence/repositories/audit.repository.js';
import type { IdempotencyRepository } from '../persistence/repositories/idempotency.repository.js';
import type { AuditService } from '../audit/audit-service.js';
import type { WebhookRepository } from '../webhooks/webhook.repository.js';
import type { CompensationService } from '../compensation/compensation-service.js';
import type { ReconciliationService } from '../reconciliation/reconciliation-service.js';
import type { RateLimiter } from '../resilience/rate-limiter.js';

export interface ServerDeps {
  db: Pool;
  channel: Channel;
  jwtSecret: string;
  pipeline: PaymentPipeline;
  paymentRepo: PaymentRepository;
  auditRepo: AuditRepository;
  idempotencyRepo: IdempotencyRepository;
  auditService: AuditService;
  translator: Translator;
  mappingLoader: MappingLoader;
  webhookRepo: WebhookRepository;
  compensationService: CompensationService;
  reconciliationService: ReconciliationService;
  rateLimiter: RateLimiter;
}

export async function buildServer(deps: ServerDeps) {
  const app = Fastify({
    logger: false,
    requestIdLogLabel: 'trace_id',
    bodyLimit: 1_048_576, // 1MB max body
    // P08: trust X-Forwarded-* from upstream nginx so rate limiter sees real client IP.
    trustProxy: true,
  });

  // P08: CORS with explicit allow-list (was `origin: true`).
  const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin requests / curl / server-to-server have no Origin header — allow.
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      logger.warn({ origin }, 'CORS: origin rejected');
      cb(new Error('CORS: origin not allowed'), false);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });
  await app.register(helmet);

  // P08: JWT with algorithm pinning + iss/aud verification.
  await app.register(fastifyJwt, {
    secret: deps.jwtSecret,
    sign: {
      algorithm: 'HS256',
      iss: 'mipit-core',
      aud: 'mipit-ui',
      expiresIn: '24h',
    },
    verify: {
      algorithms: ['HS256'],
      allowedIss: 'mipit-core',
      allowedAud: 'mipit-ui',
      maxAge: '24h',
    },
  });

  // Security: HTTP rate limiting (before auth)
  registerRateLimitMiddleware(app, {
    maxRequests: env.HTTP_RATE_LIMIT_MAX,
    windowMs: env.HTTP_RATE_LIMIT_WINDOW_MS,
  });

  // Security: Input sanitization (XSS + proto-pollution + size caps; no more regex-anti-SQL)
  registerSanitizationMiddleware(app);

  app.addHook('onRequest', tracingMiddleware);

  app.setErrorHandler(errorHandler);

  // Public routes (no auth required)
  await app.register(healthRoutes);
  await app.register(metricsRoutes);

  // SSE routes — P08: token via query string verified internally (EventSource can't send headers)
  await app.register(registerSseRoutes);
  // W5.2 — public webhook endpoint for AlertManager (machine-to-machine, no JWT)
  await app.register(registerWebhookRoutes);

  // P08: demo /auth/token endpoint gated to non-production.
  if (env.NODE_ENV !== 'production') {
    const tokenHandler = async (
      _req: import('fastify').FastifyRequest,
      reply: import('fastify').FastifyReply,
    ) => {
      const token = app.jwt.sign({ sub: 'mipit-ui', role: 'admin' });
      return reply.send({ access_token: token, token_type: 'Bearer', expires_in: 86400 });
    };
    app.get('/auth/token', tokenHandler);
    app.post('/auth/token', tokenHandler);
  } else {
    const denied = async (_req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
      reply.code(404);
      return { error: 'NOT_FOUND', message: '/auth/token is disabled in production. Use OIDC.' };
    };
    app.get('/auth/token', denied);
    app.post('/auth/token', denied);
  }

  // Authenticated routes
  await app.register(async (scoped) => {
    scoped.addHook('onRequest', authMiddleware);
    await paymentRoutes(scoped, deps);
    await translateRoutes(scoped, { translator: deps.translator, mappingLoader: deps.mappingLoader });
    await registerUiProxyRoutes(scoped);
    await registerAnalyticsRoutes(scoped, {
      reconciliationService: deps.reconciliationService,
      rateLimiter: deps.rateLimiter,
      db: deps.db,
    });
    await registerCompensationRoutes(scoped, deps);
  });

  logger.info('Fastify server built — routes: health, metrics, sse, webhooks, payments, translate, analytics, compensation');

  return app;
}

async function registerCompensationRoutes(app: import('fastify').FastifyInstance, deps: ServerDeps) {
  app.post<{ Params: { paymentId: string } }>(
    '/compensate/:paymentId',
    async (req, reply) => {
      const { paymentId } = req.params;
      const result = await deps.compensationService.compensate(paymentId);
      return reply.status(result.success ? 200 : 422).send(result);
    },
  );

  app.post<{ Body: { limit?: number } }>(
    '/compensate/batch',
    async (req, reply) => {
      const limit = (req.body as { limit?: number })?.limit ?? 50;
      const result = await deps.compensationService.compensateBatch(limit);
      return reply.send(result);
    },
  );
}
