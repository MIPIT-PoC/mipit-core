/**
 * Input Sanitization Middleware
 *
 * Validates and sanitizes incoming request bodies to prevent:
 *   - XSS (script injection in string fields)
 *   - SQL injection patterns
 *   - Oversized payloads
 *   - Prototype pollution
 *
 * Applied as a Fastify preHandler hook on POST/PUT/PATCH routes.
 */

import type { FastifyInstance } from 'fastify';
import { logger } from '../../observability/logger.js';

/** Patterns that indicate potential injection attacks */
const DANGEROUS_PATTERNS = [
  /<script\b[^>]*>/i,
  /javascript:/i,
  /on\w+\s*=/i,
  /(\b(union|select|insert|update|delete|drop|alter|exec|execute)\b.*\b(from|into|table|where)\b)/i,
  /--\s/,        // SQL comment
  /;\s*(drop|delete|update|insert)/i,
];

/** Keys that could enable prototype pollution */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function registerSanitizationMiddleware(app: FastifyInstance): void {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.body || typeof req.body !== 'object') return;

    try {
      sanitizeObject(req.body as Record<string, unknown>, '');
    } catch (err) {
      logger.warn({ err, url: req.url, method: req.method }, 'Request rejected by sanitization');
      return reply.status(400).send({
        error: 'INVALID_INPUT',
        message: err instanceof Error ? err.message : 'Input validation failed',
      });
    }
  });
}

function sanitizeObject(obj: Record<string, unknown>, path: string): void {
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;

    // Prototype pollution check
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Forbidden key detected: ${currentPath}`);
    }

    if (typeof value === 'string') {
      // Check for dangerous patterns
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(value)) {
          throw new Error(`Potentially dangerous input detected in ${currentPath}`);
        }
      }

      // Check string length (max 10KB per field)
      if (value.length > 10_240) {
        throw new Error(`Field ${currentPath} exceeds maximum length (10KB)`);
      }
    } else if (Array.isArray(value)) {
      // Limit array size
      if (value.length > 1000) {
        throw new Error(`Array ${currentPath} exceeds maximum size (1000 elements)`);
      }
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] === 'object' && value[i] !== null) {
          sanitizeObject(value[i] as Record<string, unknown>, `${currentPath}[${i}]`);
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      sanitizeObject(value as Record<string, unknown>, currentPath);
    }
  }
}
