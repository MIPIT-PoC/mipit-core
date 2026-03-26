import type { FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { trace } from '@opentelemetry/api';

export async function tracingMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const traceId = (request.headers['x-trace-id'] as string) ?? ulid();

  (request as unknown as Record<string, unknown>).traceId = traceId;

  reply.header('X-Trace-ID', traceId);

  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.setAttribute('mipit.trace_id', traceId);
  }
}
