import type { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { IdempotencyRepository } from '../../persistence/repositories/idempotency.repository.js';

export function idempotencyMiddleware(repo: IdempotencyRepository) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.headers['idempotency-key'] as string | undefined;
    if (!key) return;

    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(request.body))
      .digest('hex');

    const existing = await repo.findByKey(key);

    if (existing) {
      if (existing.request_hash !== requestHash) {
        return reply.status(409).send({
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'Idempotency-Key already used with a different payload',
        });
      }
      return reply.status(existing.response_status ?? 202).send(existing.response_body);
    }

    (request as Record<string, unknown>).idempotencyKey = key;
    (request as Record<string, unknown>).requestHash = requestHash;
  };
}
