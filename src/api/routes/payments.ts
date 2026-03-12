import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import { createPaymentSchema } from '../schemas/payment-request.js';

export async function paymentRoutes(app: FastifyInstance, _deps: ServerDeps) {
  // TODO: Implement dependency injection for pipeline and repository
  // const translator = new Translator();
  // const normalizer = new Normalizer();
  // const routeEngine = new RouteEngine();
  // const publisher = new Publisher(deps.channel);
  // const paymentRepo = new PaymentRepository(deps.db);
  // const auditService = new AuditService(deps.db);
  // const pipeline = new PaymentPipeline(translator, normalizer, routeEngine, publisher, paymentRepo, auditService);

  app.post(
    '/payments',
    async (request, reply) => {
      createPaymentSchema.parse(request.body);
      // const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
      // const traceId = request.headers['x-trace-id'] as string | undefined;
      // const result = await pipeline.execute(body, { idempotencyKey, traceId });

      return reply.status(202).send({
        payment_id: 'placeholder',
        status: 'RECEIVED',
        received_at: new Date().toISOString(),
        destination: 'placeholder',
      });
    },
  );

  app.get(
    '/payments/:paymentId',
    async (request, reply) => {
      const { paymentId } = request.params as { paymentId: string };
      // const payment = await paymentRepo.findById(paymentId);

      return reply.send({
        payment_id: paymentId,
        status: 'RECEIVED',
        origin: 'placeholder',
        destination: 'placeholder',
        amount: 0,
        currency: 'BRL',
        original: {},
        canonical: {},
        translated: {},
        rail_ack: null,
        timestamps: {
          created_at: new Date().toISOString(),
          validated_at: null,
          canonicalized_at: null,
          routed_at: null,
          queued_at: null,
          sent_at: null,
          acked_at: null,
          completed_at: null,
        },
      });
    },
  );
}
