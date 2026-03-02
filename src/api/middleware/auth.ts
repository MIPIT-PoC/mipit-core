import type { FastifyRequest, FastifyReply } from 'fastify';

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({
      code: 'UNAUTHORIZED',
      message: 'Missing or invalid Authorization header',
    });
  }

  const token = authHeader.slice(7);

  // TODO: Verify JWT using @fastify/jwt — decode and validate claims
  if (!token) {
    return reply.status(401).send({
      code: 'UNAUTHORIZED',
      message: 'Invalid token',
    });
  }
}
