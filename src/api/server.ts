import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { Pool } from 'pg';
import type { Channel } from 'amqplib';
import { paymentRoutes } from './routes/payments.js';
import { healthRoutes } from './routes/health.js';
import { metricsRoutes } from './routes/metrics.js';
import { errorHandler } from './middleware/error-handler.js';
import { logger } from '../observability/logger.js';

export interface ServerDeps {
  db: Pool;
  channel: Channel;
}

export async function buildServer(deps: ServerDeps) {
  const app = Fastify({
    logger: false,
    requestIdLogLabel: 'trace_id',
  });

  await app.register(cors, { origin: true });
  await app.register(helmet);

  app.setErrorHandler(errorHandler);

  await app.register(healthRoutes);
  await app.register(metricsRoutes);
  await app.register((fastify) => paymentRoutes(fastify, deps));

  logger.info('Fastify server built and routes registered');

  return app;
}
