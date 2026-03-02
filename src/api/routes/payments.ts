import type { FastifyInstance } from 'fastify';
import { createPaymentSchema } from '../schemas/payment-request.js';
import { PaymentPipeline } from '../../pipeline/payment-pipeline.js';
import { PaymentRepository } from '../../persistence/repositories/payment.repository.js';

export async function paymentRoutes(app: FastifyInstance) {
  const pipeline = new PaymentPipeline(/* deps injected */);
  const paymentRepo = new PaymentRepository(/* db pool */);

  app.post(
    '/payments',
    {
      preHandler: [app.authenticate, app.idempotency],
    },
    async (request, reply) => {
      const body = createPaymentSchema.parse(request.body);
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
      const traceId = request.headers['x-trace-id'] as string | undefined;

      const result = await pipeline.execute(body, { idempotencyKey, traceId });

      return reply.status(202).send({
        payment_id: result.payment_id,
        status: result.status,
        received_at: result.created_at,
        destination: result.destination_rail,
      });
    },
  );

  app.get(
    '/payments/:paymentId',
    {
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const { paymentId } = request.params as { paymentId: string };
      const payment = await paymentRepo.findById(paymentId);

      if (!payment) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: `Payment ${paymentId} not found`,
        });
      }

      return reply.send({
        payment_id: payment.payment_id,
        status: payment.status,
        origin: payment.origin_rail,
        destination: payment.destination_rail,
        amount: payment.amount,
        currency: payment.currency,
        original: payment.origin_payload,
        canonical: payment.canonical_payload,
        translated: payment.translated_payload,
        rail_ack: payment.rail_ack,
        timestamps: {
          created_at: payment.created_at,
          validated_at: payment.validated_at,
          canonicalized_at: payment.canonicalized_at,
          routed_at: payment.routed_at,
          queued_at: payment.queued_at,
          sent_at: payment.sent_at,
          acked_at: payment.acked_at,
          completed_at: payment.completed_at,
        },
      });
    },
  );
}
