import type { FastifyInstance } from 'fastify';
import { registry } from '../../observability/metrics.js';

export async function metricsRoutes(app: FastifyInstance) {
  app.get('/metrics', async (_request, reply) => {
    const metrics = await registry.metrics();
    return reply.type(registry.contentType).send(metrics);
  });
}
