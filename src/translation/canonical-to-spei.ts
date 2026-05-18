import { randomBytes } from 'node:crypto';
import type { CanonicalPacs008 } from '../domain/models/canonical.js';
import { logger } from '../observability/logger.js';

/** Banxico SPEI claveRastreo: 1-30 alphanumeric. No hyphens, dots, slashes. */
const SPEI_CR_REGEX = /^[A-Za-z0-9]{1,30}$/;

/**
 * W6.9 — Generate a Banxico-compliant claveRastreo when the canonical's
 * endToEndId doesn't satisfy the SPEI regex (e.g. came from PIX/BRE_B as
 * `E2E-${ulid()}` which contains a hyphen).
 */
function speiClaveRastreo(fallback?: string): string {
  if (fallback && SPEI_CR_REGEX.test(fallback)) return fallback;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const rnd = randomBytes(24);
  let out = 'MIPIT';
  for (let i = 0; i < 19; i++) out += alphabet[rnd[i] % alphabet.length];
  return out; // 24 chars (well within 1-30)
}

export interface SpeiOutboundPayload {
  claveRastreo: string;
  clabe: string;
  monto: number;
  moneda: string;
  nombreOrdenante?: string;
  cuentaOrdenante: string;
  nombreBeneficiario?: string;
  cuentaBeneficiario: string;
  concepto: string;
  referencia: string;
  fechaOperacion: string;
}

export async function canonicalToSpei(canonical: CanonicalPacs008): Promise<SpeiOutboundPayload> {
  const payload: SpeiOutboundPayload = {
    claveRastreo: speiClaveRastreo(canonical.pmtId.endToEndId),
    clabe: canonical.alias.value,
    monto: canonical.amount.value,
    moneda: canonical.amount.currency,
    nombreOrdenante: canonical.debtor.name,
    cuentaOrdenante: canonical.debtor.account_id,
    nombreBeneficiario: canonical.creditor.name,
    cuentaBeneficiario: canonical.creditor.account_id,
    concepto: canonical.purpose,
    referencia: canonical.reference,
    fechaOperacion: canonical.created_at.split('T')[0],
  };

  logger.debug(
    { payment_id: canonical.payment_id, destination: 'SPEI' },
    'Canonical → SPEI translation complete',
  );
  return payload;
}
