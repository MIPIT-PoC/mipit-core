/**
 * HTTP Rate Limiting Middleware
 *
 * Sliding window rate limiter per IP address.
 * Prevents abuse and DDoS at the HTTP layer (before the pipeline).
 *
 * Returns 429 Too Many Requests when limit is exceeded.
 * Adds standard rate limit headers: X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After.
 */

import type { FastifyInstance } from 'fastify';
import { logger } from '../../observability/logger.js';

interface RateLimitOptions {
  /** Max requests per window */
  maxRequests: number;
  /** Window size in ms (default: 60000 = 1 minute) */
  windowMs: number;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

const DEFAULT_OPTIONS: RateLimitOptions = {
  maxRequests: 100,
  windowMs: 60_000,
};

export function registerRateLimitMiddleware(
  app: FastifyInstance,
  options?: Partial<RateLimitOptions>,
): void {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const windows = new Map<string, WindowEntry>();

  // Cleanup stale entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windows) {
      if (now > entry.resetAt) {
        windows.delete(key);
      }
    }
  }, 5 * 60_000);

  app.addHook('onRequest', async (req, reply) => {
    // Skip rate limiting for health checks and metrics
    if (req.url === '/health' || req.url === '/healthz' || req.url === '/metrics') {
      return;
    }

    const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const key = typeof clientIp === 'string' ? clientIp : String(clientIp);
    const now = Date.now();

    let entry = windows.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      windows.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    const remaining = Math.max(0, opts.maxRequests - entry.count);
    reply.header('X-RateLimit-Limit', opts.maxRequests);
    reply.header('X-RateLimit-Remaining', remaining);
    reply.header('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > opts.maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      reply.header('Retry-After', retryAfter);
      logger.warn({ ip: key, count: entry.count, limit: opts.maxRequests }, 'HTTP rate limit exceeded');
      return reply.status(429).send({
        error: 'RATE_LIMIT_EXCEEDED',
        message: `Too many requests. Limit: ${opts.maxRequests} per ${opts.windowMs / 1000}s. Retry after ${retryAfter}s.`,
        retry_after_seconds: retryAfter,
      });
    }
  });
}
