import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { logger } from '../../observability/logger.js';
import { AppError } from '../../domain/errors/index.js';

export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  const traceId = (request as unknown as Record<string, unknown>).traceId as string | undefined;

  if (error instanceof ZodError) {
    return reply.status(400).send({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request payload',
      details: error.flatten().fieldErrors,
      trace_id: traceId,
    });
  }

  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message,
      details: error.details,
      trace_id: traceId,
    });
  }

  logger.error({ err: error, trace_id: traceId }, 'Unhandled error');

  return reply.status(500).send({
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    trace_id: traceId,
  });
}
