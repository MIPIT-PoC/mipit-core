import { type CanonicalPacs008 } from '../domain/models/canonical.js';
import { TranslationError } from '../domain/errors/index.js';
import { logger } from '../observability/logger.js';
import { generateBrebTransactionId, BREB_ENTITY_CODES, type BreBPaymentRequest } from './breb-to-canonical.js';

/**
 * Translates a canonical pacs.008 model to a Bre-B payment request.
 *
 * Field mappings:
 *   canonical.amount.value         → valor.original (as string with 2 decimals)
 *   canonical.origin.ispb          → pagador.codigoEntidad (or default)
 *   canonical.destination.ispb     → beneficiario.codigoEntidad (or default)
 *   canonical.debtor.*             → pagador.*
 *   canonical.creditor.*           → beneficiario.*
 *   canonical.alias.value          → llave
 *   canonical.remittanceInfo       → concepto
 */
export async function canonicalToBreb(
  canonical: CanonicalPacs008,
): Promise<BreBPaymentRequest> {
  const log = logger.child({ payment_id: canonical.payment_id, rail: 'BRE_B' });

  try {
    // Derive entity codes — prefer stored ispb, fall back to simulated
    const pagadorEntidad = canonical.origin.ispb ?? BREB_ENTITY_CODES.FINTECH_SIMULATED;
    const beneficiarioEntidad = canonical.destination.ispb ?? BREB_ENTITY_CODES.FINTECH_SIMULATED;

    // Strip entity prefix from account_id if present ("codigoEntidad/account")
    const debtorAccountRaw = canonical.debtor.account_id;
    const debtorAccount = debtorAccountRaw.includes('/')
      ? debtorAccountRaw.split('/').slice(1).join('/')
      : debtorAccountRaw;

    const creditorAccountRaw = canonical.creditor.account_id;
    const creditorAccount = creditorAccountRaw.includes('/')
      ? creditorAccountRaw.split('/').slice(1).join('/')
      : creditorAccountRaw;

    // Derive llave from alias (if already a Bre-B alias) or use creditor account
    const rawLlave = canonical.alias.type === 'LLAVE_BREB'
      ? canonical.alias.value
      : creditorAccount;
    const llave = rawLlave.replace(/^BREB-/, '');

    const idTransaccion = generateBrebTransactionId(pagadorEntidad);

    const request: BreBPaymentRequest = {
      idTransaccion,
      valor: {
        original: canonical.amount.value.toFixed(2),
      },
      pagador: {
        codigoEntidad: pagadorEntidad,
        nombre: (canonical.debtor.name ?? 'REMITENTE').substring(0, 140),
        nit: canonical.debtor.taxId?.includes('-')
          ? canonical.debtor.taxId
          : undefined,
        cc: canonical.debtor.taxId && !canonical.debtor.taxId.includes('-')
          ? canonical.debtor.taxId
          : undefined,
        numeroCuenta: debtorAccount,
        tipoCuenta: (canonical.debtor.accountType as 'CACC' | 'SVGS' | 'TRAN') ?? 'CACC',
      },
      beneficiario: {
        codigoEntidad: beneficiarioEntidad,
        nombre: (canonical.creditor.name ?? 'BENEFICIARIO').substring(0, 140),
        nit: canonical.creditor.taxId?.includes('-')
          ? canonical.creditor.taxId
          : undefined,
        cc: canonical.creditor.taxId && !canonical.creditor.taxId.includes('-')
          ? canonical.creditor.taxId
          : undefined,
        numeroCuenta: creditorAccount,
        tipoCuenta: (canonical.creditor.accountType as 'CACC' | 'SVGS' | 'TRAN') ?? 'CACC',
      },
      llave,
      concepto: canonical.remittanceInfo?.substring(0, 140) ?? canonical.reference.substring(0, 140),
      fechaHora: canonical.created_at,
    };

    log.info('Canonical → Bre-B translation complete');
    return request;
  } catch (err) {
    if (err instanceof TranslationError) throw err;
    log.error({ err }, 'Unexpected error in canonicalToBreb');
    throw new TranslationError('BRE_B', 'Unexpected error during canonical → Bre-B translation', { cause: err });
  }
}
