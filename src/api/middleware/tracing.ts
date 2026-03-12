import type { FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';

export async function tracingMiddleware(request: FastifyRequest, _reply: FastifyReply) {
  const traceId = (request.headers['x-trace-id'] as string) ?? ulid();
  (request as unknown as Record<string, unknown>).traceId = traceId;
}
