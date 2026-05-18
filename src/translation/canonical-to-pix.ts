import { randomBytes } from 'node:crypto';
import type { CanonicalPacs008 } from '../domain/models/canonical.js';
import { logger } from '../observability/logger.js';

/** BCB SPI EndToEndId: E + ISPB(8) + YYYYMMDDHHmm(BRT/UTC-3) + 11 alnum = 32 chars */
const PIX_E2E_REGEX = /^E\d{8}\d{12}[A-Za-z0-9]{11}$/;

/**
 * W6.9 — Generate a BCB-compliant EndToEndId when the canonical's value
 * does not satisfy the SPI regex. Avoids translating a SPEI/BRE_B sourced
 * canonical (which carries `E2E-${ulid()}`) into a PIX payload the mock
 * would reject.
 */
function pixEndToEndId(ispb: string, fallback?: string): string {
  if (fallback && PIX_E2E_REGEX.test(fallback)) return fallback;
  const safeIspb = (ispb && /^\d{8}$/.test(ispb)) ? ispb : '00000000';
  // Brasília Time = UTC-3 → subtract 3h from UTC for the timestamp portion.
  const nowBrt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const ts = nowBrt.toISOString().replace(/[-:T]/g, '').slice(0, 12); // YYYYMMDDHHmm
  // CSPRNG-derived 11 alnum [A-Z0-9]
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const rnd = randomBytes(11);
  let suffix = '';
  for (let i = 0; i < 11; i++) suffix += alphabet[rnd[i] % alphabet.length];
  return `E${safeIspb}${ts}${suffix}`;
}

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
    endToEndId: pixEndToEndId(canonical.origin.ispb ?? '', canonical.pmtId.endToEndId),
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
