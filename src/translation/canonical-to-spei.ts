import type { CanonicalPacs008 } from '../domain/models/canonical.js';
import { logger } from '../observability/logger.js';

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
    claveRastreo: canonical.pmtId.endToEndId,
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
