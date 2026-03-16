import type { CanonicalPacs008 } from '../domain/models/canonical.js';
import { logger } from '../observability/logger.js';

export interface PixOutboundPayload {
  endToEndId: string;
  pixKey: string;
  amount: number;
  currency: string;
  debtorName?: string;
  debtorAccount: string;
  creditorName?: string;
  creditorAccount: string;
  purpose: string;
  reference: string;
  createdAt: string;
}

export async function canonicalToPix(canonical: CanonicalPacs008): Promise<PixOutboundPayload> {
  const payload: PixOutboundPayload = {
    endToEndId: canonical.pmtId.endToEndId,
    pixKey: canonical.alias.value,
    amount: canonical.amount.value,
    currency: canonical.amount.currency,
    debtorName: canonical.debtor.name,
    debtorAccount: canonical.debtor.account_id,
    creditorName: canonical.creditor.name,
    creditorAccount: canonical.creditor.account_id,
    purpose: canonical.purpose,
    reference: canonical.reference,
    createdAt: canonical.created_at,
  };

  logger.debug(
    { payment_id: canonical.payment_id, destination: 'PIX' },
    'Canonical → PIX translation complete',
  );
  return payload;
}
