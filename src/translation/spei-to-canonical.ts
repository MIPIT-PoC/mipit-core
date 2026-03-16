import { ulid } from 'ulid';
import { canonicalPacs008Schema, type CanonicalPacs008 } from '../domain/models/canonical.js';
import type { CreatePaymentRequest } from '../api/schemas/payment-request.js';
import { TranslationError } from '../domain/errors/index.js';
import { logger } from '../observability/logger.js';

export async function speiToCanonical(
  payload: unknown,
  paymentId: string,
  traceId?: string,
): Promise<CanonicalPacs008> {
  const req = payload as CreatePaymentRequest;
  const now = new Date().toISOString();

  const aliasValue = req.creditor.alias.startsWith('CLABE-')
    ? req.creditor.alias.slice(6)
    : req.creditor.alias;

  const raw = {
    payment_id: paymentId,
    created_at: now,
    grpHdr: { msgId: `MSG-${ulid()}`, creDtTm: now },
    pmtId: { endToEndId: `E2E-${ulid()}` },
    amount: {
      value: req.amount,
      currency: (req.currency ?? 'MXN').toUpperCase(),
    },
    fx: { source_currency: 'MXN' },
    origin: { rail: 'SPEI' as const },
    destination: { rail: undefined },
    debtor: {
      name: req.debtor.name,
      country: 'MX',
      account_id: req.debtor.alias,
    },
    creditor: {
      name: req.creditor.name,
      country: undefined,
      account_id: req.creditor.alias,
    },
    alias: { type: 'CLABE' as const, value: aliasValue },
    purpose: req.purpose ?? 'P2P',
    reference: req.reference ?? 'MIPIT-POC',
    status: 'RECEIVED',
    trace_id: traceId,
  };

  const result = canonicalPacs008Schema.safeParse(raw);
  if (!result.success) {
    logger.error({ payment_id: paymentId, errors: result.error.flatten() }, 'SPEI → Canonical validation failed');
    throw new TranslationError('SPEI', 'Invalid canonical output from SPEI translation', {
      zodErrors: result.error.flatten().fieldErrors,
    });
  }

  logger.debug({ payment_id: paymentId, origin: 'SPEI' }, 'SPEI → Canonical translation complete');
  return result.data;
}
