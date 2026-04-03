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
import type { Translator } from '../translation/translator.js';
import type { MappingLoader } from '../translation/mapping-loader.js';
import { errorHandler } from './middleware/error-handler.js';
import { tracingMiddleware } from './middleware/tracing.js';
import { authMiddleware } from './middleware/auth.js';
import { logger } from '../observability/logger.js';
import type { PaymentPipeline } from '../pipeline/payment-pipeline.js';
import type { PaymentRepository } from '../persistence/repositories/payment.repository.js';
import type { AuditRepository } from '../persistence/repositories/audit.repository.js';
import type { IdempotencyRepository } from '../persistence/repositories/idempotency.repository.js';
import type { AuditService } from '../audit/audit-service.js';
import type { WebhookRepository } from '../webhooks/webhook.repository.js';

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
}

export async function buildServer(deps: ServerDeps) {
  const app = Fastify({
    logger: false,
    requestIdLogLabel: 'trace_id',
  });

  await app.register(cors, { origin: true });
  await app.register(helmet);
  await app.register(fastifyJwt, { secret: deps.jwtSecret });

  app.addHook('onRequest', tracingMiddleware);

  app.setErrorHandler(errorHandler);

  await app.register(healthRoutes);
  await app.register(metricsRoutes);
  await app.register(async (scoped) => {
    scoped.addHook('onRequest', authMiddleware);
    await paymentRoutes(scoped, deps);
    await translateRoutes(scoped, { translator: deps.translator, mappingLoader: deps.mappingLoader });
  });

  logger.info('Fastify server built and routes registered');

  return app;
}
