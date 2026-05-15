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
  });

  await app.register(cors, { origin: true });
  await app.register(helmet);
  await app.register(fastifyJwt, { secret: deps.jwtSecret });

  // Security: HTTP rate limiting (before auth)
  // Configurable via HTTP_RATE_LIMIT_MAX / HTTP_RATE_LIMIT_WINDOW_MS so the
  // E2E + load suites can run higher volumes without colliding with the
  // production default. Production env files keep the default (200/60s).
  const httpRateLimitMax = Number(process.env.HTTP_RATE_LIMIT_MAX ?? '200');
  const httpRateLimitWindowMs = Number(process.env.HTTP_RATE_LIMIT_WINDOW_MS ?? '60000');
  registerRateLimitMiddleware(app, {
    maxRequests: httpRateLimitMax,
    windowMs: httpRateLimitWindowMs,
  });

  // Security: Input sanitization
  registerSanitizationMiddleware(app);

  app.addHook('onRequest', tracingMiddleware);

  app.setErrorHandler(errorHandler);

  // Public routes (no auth required)
  await app.register(healthRoutes);
  await app.register(metricsRoutes);

  // SSE routes (no auth — UI subscribes directly)
  await app.register(registerSseRoutes);

  // Demo token endpoint (PoC only — returns a JWT for the UI)
  const tokenHandler = async (_req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    const token = app.jwt.sign({ sub: 'mipit-ui', role: 'admin' }, { expiresIn: '24h' });
    return reply.send({ access_token: token, token_type: 'Bearer', expires_in: 86400 });
  };
  app.get('/auth/token', tokenHandler);
  app.post('/auth/token', tokenHandler);

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

  logger.info('Fastify server built — routes: health, metrics, sse, payments, translate, analytics, compensation');

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
