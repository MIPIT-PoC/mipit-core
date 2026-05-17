/**
 * Input Sanitization Middleware (P08 — slimmed down).
 *
 * Previously this middleware applied a regex-based "anti-SQL" filter that
 * rejected legitimate payloads containing substrings like "update the form"
 * (matched `update` + `form`). All DB queries are parameterized (verified
 * in audit), so the SQL filter was theater + false-positive prone — removed.
 *
 * What remains:
 *   - Prototype-pollution key block (`__proto__`, `constructor`, `prototype`)
 *   - Conservative limits on string size (10KB) and array size (1000 elements)
 *   - XSS pattern detection (script/javascript:/event handlers) on string values
 */

import type { FastifyInstance } from 'fastify';
import { logger } from '../../observability/logger.js';

/** Patterns indicating XSS attempts. */
const XSS_PATTERNS = [
  /<script\b[^>]*>/i,
  /javascript:/i,
  /on\w+\s*=/i,
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
      // XSS only — no more anti-SQL false positives
      for (const pattern of XSS_PATTERNS) {
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
