import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import { createPaymentSchema } from '../schemas/payment-request.js';
import { idempotencyMiddleware } from '../middleware/idempotency.js';
import { NotFoundError } from '../../domain/errors/index.js';
import { logger } from '../../observability/logger.js';
import { z } from 'zod';

const registerWebhookSchema = z.object({
  url: z.string().url('url must be a valid HTTP/HTTPS URL'),
  events: z.array(z.enum(['COMPLETED', 'FAILED', 'REJECTED'])).optional(),
  secret: z.string().min(8).optional(),
});

export async function paymentRoutes(app: FastifyInstance, deps: ServerDeps) {
  const { pipeline, paymentRepo, auditRepo, idempotencyRepo, webhookRepo } = deps;
  const idempotencyHook = idempotencyMiddleware(idempotencyRepo);

  app.post(
    '/payments',
    { preHandler: idempotencyHook },
    async (request, reply) => {
      const body = createPaymentSchema.parse(request.body);
      const traceId = (request as unknown as Record<string, unknown>).traceId as string;
      const idempotencyKey = (request as unknown as Record<string, unknown>).idempotencyKey as string | undefined;
      const requestHash = (request as unknown as Record<string, unknown>).requestHash as string | undefined;

      const result = await pipeline.execute(body, {
        idempotencyKey,
        traceId,
      });

      const responseBody = {
        payment_id: result.payment_id,
        status: result.status,
        created_at: result.created_at,
        destination_rail: result.destination_rail,
      };

      if (idempotencyKey && requestHash) {
        await idempotencyRepo.insert({
          idempotency_key: idempotencyKey,
          payment_id: result.payment_id,
          request_hash: requestHash,
          response_status: 201,
          response_body: responseBody,
          created_at: new Date().toISOString(),
        });
      }

      logger.info(
        { payment_id: result.payment_id, trace_id: traceId },
        'Payment created successfully',
      );

      return reply.status(201).send(responseBody);
    },
  );

  app.get(
    '/payments/:paymentId',
    async (request, reply) => {
      const { paymentId } = request.params as { paymentId: string };

      const payment = await paymentRepo.findById(paymentId);
      if (!payment) {
        throw new NotFoundError('Payment', paymentId);
      }

      const auditEvents = await auditRepo.findByPaymentId(paymentId);

      return reply.send({
        payment_id: payment.payment_id,
        status: payment.status,
        origin_rail: payment.origin_rail,
        destination_rail: payment.destination_rail ?? null,
        amount: payment.amount,
        currency: payment.currency,
        debtor: { alias: payment.debtor_alias, name: payment.debtor_name },
        creditor: { alias: payment.creditor_alias, name: payment.creditor_name },
        purpose: payment.purpose,
        reference: payment.reference,
        original_payload: payment.origin_payload,
        canonical_payload: payment.canonical_payload ?? null,
        translated_payload: payment.translated_payload ?? null,
        rail_ack: payment.rail_ack ?? null,
        route_rule_applied: payment.route_rule_applied ?? null,
        trace_id: payment.trace_id,
        timestamps: {
          created_at: payment.created_at,
          validated_at: payment.validated_at ?? null,
          canonicalized_at: payment.canonicalized_at ?? null,
          routed_at: payment.routed_at ?? null,
          queued_at: payment.queued_at ?? null,
          sent_at: payment.sent_at ?? null,
          acked_at: payment.acked_at ?? null,
          completed_at: payment.completed_at ?? null,
        },
        audit_trail: auditEvents.map((e) => ({
          id: e.id,
          event_type: e.event_type,
          actor: e.actor,
          detail: e.detail,
          trace_id: e.trace_id,
          created_at: e.created_at,
        })),
      });
    },
  );

  /**
   * POST /payments/:paymentId/webhook
   * Register a webhook URL to be notified when the payment reaches a terminal status.
   * Body: { url, events?, secret? }
   * Response: the created webhook subscription
   */
  app.post('/payments/:paymentId/webhook', async (request, reply) => {
    const { paymentId } = request.params as { paymentId: string };

    const payment = await paymentRepo.findById(paymentId);
    if (!payment) {
      throw new NotFoundError('Payment', paymentId);
    }

    const body = registerWebhookSchema.parse(request.body);

    const sub = await webhookRepo.create({
      payment_id: paymentId,
      url: body.url,
      events: body.events,
      secret: body.secret,
    });

    logger.info({ payment_id: paymentId, webhook_id: sub.id, url: body.url }, 'Webhook subscription registered');

    return reply.status(201).send({
      id: sub.id,
      payment_id: sub.payment_id,
      url: sub.url,
      events: sub.events,
      created_at: sub.created_at,
    });
  });

  /**
   * GET /payments/:paymentId/webhooks
   * List all webhook subscriptions for a payment.
   */
  app.get('/payments/:paymentId/webhooks', async (request, reply) => {
    const { paymentId } = request.params as { paymentId: string };

    const payment = await paymentRepo.findById(paymentId);
    if (!payment) {
      throw new NotFoundError('Payment', paymentId);
    }

    const subs = await webhookRepo.findByPaymentId(paymentId);
    return reply.send(subs.map((s) => ({
      id: s.id,
      url: s.url,
      events: s.events,
      fired_at: s.fired_at,
      last_http_status: s.last_http_status,
      delivery_attempts: s.delivery_attempts,
      last_error: s.last_error,
      created_at: s.created_at,
    })));
  });
}
