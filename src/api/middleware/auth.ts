import type { FastifyRequest, FastifyReply } from 'fastify';

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid token';
    return reply.status(401).send({
      code: 'UNAUTHORIZED',
      message: `Authentication failed: ${message}`,
    });
  }
}
