import pino from 'pino';
import { trace } from '@opentelemetry/api';
import { env } from '../config/env.js';

/**
 * P07 — Pino logger with PII redaction.
 *
 * Audit finding C53: logger emitted debtor/creditor name, taxId, alias,
 * email, phone in plain text — leaking PII when log shipping. The redact
 * paths below mask the values to `[REDACTED]` while preserving the
 * surrounding structure so debugging context (path, payment_id) is intact.
 *
 * Auth headers and JWTs are also masked to avoid leaking tokens into logs.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { service: env.OTEL_SERVICE_NAME },
  redact: {
    paths: [
      // PII at any depth — debtor + creditor structured fields
      '*.debtor.taxId',
      '*.debtor.name',
      '*.debtor.email',
      '*.debtor.phone',
      '*.debtor.account_id',
      '*.creditor.taxId',
      '*.creditor.name',
      '*.creditor.email',
      '*.creditor.phone',
      '*.creditor.account_id',
      // Native rail payloads — same data with rail-specific field names
      '*.pagador.nome',
      '*.pagador.cpf',
      '*.pagador.cnpj',
      '*.pagador.nit',
      '*.pagador.cc',
      '*.recebedor.nome',
      '*.recebedor.cpf',
      '*.recebedor.cnpj',
      '*.beneficiario.nombre',
      '*.beneficiario.nit',
      '*.beneficiario.cc',
      // Aliases (chave, CLABE, llave) — high signal for tracing one user
      '*.alias.value',
      '*.chave',
      '*.cuentaBeneficiario',
      '*.cuentaOrdenante',
      '*.llave',
      // Auth headers + tokens at HTTP level
      'req.headers.authorization',
      'req.headers["idempotency-key"]',
      'res.headers["set-cookie"]',
      'jwt',
      'token',
      'access_token',
      'secret',
      'password',
      'apiKey',
      'api_key',
    ],
    censor: '[REDACTED]',
  },
  mixin() {
    const span = trace.getActiveSpan();
    if (!span) return {};
    const { traceId, spanId } = span.spanContext();
    return { trace_id: traceId, span_id: spanId };
  },
});

export function createChildLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}

export type { Logger } from 'pino';
