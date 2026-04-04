import { ulid } from 'ulid';
import { canonicalPacs008Schema, type CanonicalPacs008 } from '../domain/models/canonical.js';
import { TranslationError } from '../domain/errors/index.js';
import { logger } from '../observability/logger.js';

/**
 * Bre-B (Banco de la República — Colombia) Payment Message
 * Instant payment system operated by Banco de la República (BanRep).
 * Launched: 2023 as the Colombian national instant payment infrastructure.
 *
 * Key identifiers:
 *   - codigoEntidad: 8-digit BanRep entity code (analogous to BACEN ISPB)
 *   - llave: alias — phone (+57...), NIT, email, or alias string
 *   - tipoLlave: TELEFONO | NIT | EMAIL | ALIAS
 *   - idTransaccion: BR + entity(8) + YYYYMMDD(8) + HHmm(4) + unique(10) = 32 chars
 *   - Currency: always COP (Colombian Peso)
 *
 * Error codes (BanRep spec):
 *   BREB001 — Fondos insuficientes
 *   BREB002 — Cuenta/entidad no encontrada
 *   BREB003 — Límite de transacción excedido
 *   BREB004 — Receptor no registrado en Bre-B
 *   BREB005 — Timeout sistema
 */

export type BreBKeyType = 'TELEFONO' | 'NIT' | 'EMAIL' | 'ALIAS';
export type BreBAccountType = 'CACC' | 'SVGS' | 'TRAN';
export type BreBStatus = 'ACEPTADA' | 'RECHAZADA' | 'EN_PROCESO' | 'DEVUELTA';

/**
 * Bre-B payment request — sent to BanRep SPI endpoint.
 * POST /breb/v1/pagos
 */
export interface BreBPaymentRequest {
  /**
   * Transaction identifier.
   * Format: BR + codigoEntidad(8) + YYYYMMDD(8) + HHmm(4) + unique(10) = 32 chars
   */
  idTransaccion: string;

  /** Payment value */
  valor: {
    /** Amount with exactly 2 decimal places as string. e.g. "500000.00" (COP) */
    original: string;
  };

  /** Payer (debtor) */
  pagador: {
    /** BanRep entity code (8 digits, zero-padded). e.g. "26264220" */
    codigoEntidad: string;
    /** Full legal name (max 140 chars) */
    nombre: string;
    /** NIT (tax ID for companies, e.g. "900123456-1") */
    nit?: string;
    /** Cédula de ciudadanía (personal ID) */
    cc?: string;
    /** Account number at the originating entity */
    numeroCuenta?: string;
    tipoCuenta?: BreBAccountType;
  };

  /** Beneficiary (creditor) */
  beneficiario: {
    /** BanRep entity code (8 digits) */
    codigoEntidad: string;
    /** Full legal name (max 140 chars) */
    nombre: string;
    nit?: string;
    cc?: string;
    numeroCuenta?: string;
    tipoCuenta?: BreBAccountType;
  };

  /** Bre-B alias of the beneficiary */
  llave: string;

  /** Type of alias */
  tipoLlave?: BreBKeyType;

  /** Payment concept / description (max 140 chars) */
  concepto?: string;

  /** ISO 8601 timestamp */
  fechaHora?: string;
}

/**
 * Bre-B payment response from BanRep.
 */
export interface BreBPaymentResponse {
  idTransaccion: string;
  idConfirmacion: string;  // BanRep internal transaction ID
  estado: BreBStatus;
  fechaLiquidacion?: string;
  codigoError?: string;
  descripcionError?: string;
}

/** BanRep entity codes for major Colombian financial institutions */
export const BREB_ENTITY_CODES = {
  BANCOLOMBIA:       '00000007',
  BANCO_DE_BOGOTA:   '00000013',
  DAVIVIENDA:        '00000051',
  BBVA_COLOMBIA:     '00000013',
  NEQUI:             '10007550',
  DAVIPLATA:         '00005141',
  BANCAMIA:          '00000022',
  FINTECH_SIMULATED: '26264220', // Simulated entity code for PoC
} as const;

/**
 * Generates a valid Bre-B idTransaccion.
 * Format: BR + codigoEntidad(8) + YYYYMMDD(8) + HHmm(4) + unique(10) = 32 chars
 */
export function generateBrebTransactionId(
  codigoEntidad: string = BREB_ENTITY_CODES.FINTECH_SIMULATED,
): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');  // YYYYMMDD
  const time = now.toISOString().slice(11, 16).replace(':', '');   // HHmm
  const unique = Math.random().toString(36).substring(2, 12).toUpperCase().padEnd(10, '0');
  return `BR${codigoEntidad}${date}${time}${unique}`;
}

/** Infer alias type from the llave value */
function inferTipoLlave(llave: string): BreBKeyType {
  if (/^\+57\d{10}$/.test(llave)) return 'TELEFONO';
  if (/^\d{9,10}-\d$/.test(llave)) return 'NIT';
  if (llave.includes('@')) return 'EMAIL';
  return 'ALIAS';
}

/**
 * Detect whether the payload is a native BreBPaymentRequest or a generic API request.
 */
function isNativeBrebPayload(payload: Record<string, unknown>): boolean {
  return 'valor' in payload && 'pagador' in payload && 'beneficiario' in payload;
}

/**
 * Strip rail prefix from alias value.
 */
function stripBrebPrefix(alias: string): string {
  return alias.startsWith('BREB-') ? alias.slice(5) : alias;
}

/**
 * Translates a Bre-B payment request to the canonical pacs.008 model.
 * Supports both:
 *   - Native BreBPaymentRequest (from /translate endpoints or direct BanRep format)
 *   - Generic API request (from POST /payments with { amount, currency, debtor, creditor })
 */
export async function brebToCanonical(
  payload: BreBPaymentRequest | Record<string, unknown>,
  paymentId: string,
  traceId?: string,
): Promise<CanonicalPacs008> {
  const log = logger.child({ payment_id: paymentId, rail: 'BRE_B' });

  try {
    const now = new Date().toISOString();
    let raw: Record<string, unknown>;

    if (isNativeBrebPayload(payload as Record<string, unknown>)) {
      const msg = payload as BreBPaymentRequest;
      const amount = parseFloat(msg.valor.original);
      const tipoLlave = msg.tipoLlave ?? inferTipoLlave(msg.llave);
      const debtorId = msg.pagador.nit ?? msg.pagador.cc ?? msg.pagador.numeroCuenta ?? 'UNKNOWN';
      const creditorId = msg.beneficiario.nit ?? msg.beneficiario.cc ?? msg.beneficiario.numeroCuenta ?? msg.llave;

      raw = {
        payment_id: paymentId,
        created_at: msg.fechaHora ?? now,
        grpHdr: {
          msgId: msg.idTransaccion ?? `MSG-${ulid()}`,
          creDtTm: msg.fechaHora ?? now,
          nbOfTxs: 1,
          sttlmInf: { sttlmMtd: 'CLRG' as const },
        },
        pmtId: {
          endToEndId: msg.idTransaccion.substring(0, 35),
        },
        amount: { value: amount, currency: 'COP' },
        origin: { rail: 'BRE_B' as const, ispb: msg.pagador.codigoEntidad },
        destination: { rail: undefined, ispb: msg.beneficiario.codigoEntidad },
        debtor: {
          name: msg.pagador.nombre?.substring(0, 140),
          country: 'CO',
          account_id: `${msg.pagador.codigoEntidad}/${debtorId}`,
          taxId: msg.pagador.nit ?? msg.pagador.cc,
          accountType: (msg.pagador.tipoCuenta as 'CACC' | 'SVGS' | 'TRAN' | 'SLRY') ?? 'CACC',
        },
        creditor: {
          name: msg.beneficiario.nombre?.substring(0, 140),
          country: 'CO',
          account_id: `${msg.beneficiario.codigoEntidad}/${creditorId}`,
          taxId: msg.beneficiario.nit ?? msg.beneficiario.cc,
          accountType: (msg.beneficiario.tipoCuenta as 'CACC' | 'SVGS' | 'TRAN' | 'SLRY') ?? 'CACC',
        },
        alias: { type: 'LLAVE_BREB' as const, value: msg.llave },
        purpose: tipoLlave === 'NIT' ? 'SUPP' : 'P2P',
        reference: msg.idTransaccion,
        remittanceInfo: msg.concepto?.substring(0, 140),
        status: 'RECEIVED',
        trace_id: traceId,
      };
    } else {
      const req = payload as {
        amount: number;
        currency?: string;
        debtor: { alias: string; name?: string };
        creditor: { alias: string; name?: string };
        purpose?: string;
        reference?: string;
      };

      const creditorLlave = stripBrebPrefix(req.creditor.alias);
      const tipoLlave = inferTipoLlave(creditorLlave);
      const txId = generateBrebTransactionId();

      raw = {
        payment_id: paymentId,
        created_at: now,
        grpHdr: {
          msgId: txId,
          creDtTm: now,
          nbOfTxs: 1,
          sttlmInf: { sttlmMtd: 'CLRG' as const },
        },
        pmtId: { endToEndId: txId.substring(0, 35) },
        amount: {
          value: req.amount,
          currency: (req.currency ?? 'COP').toUpperCase(),
        },
        fx: { source_currency: 'COP' },
        origin: { rail: 'BRE_B' as const, ispb: BREB_ENTITY_CODES.FINTECH_SIMULATED },
        destination: { rail: undefined },
        debtor: {
          name: req.debtor.name ?? 'Unknown',
          country: 'CO',
          account_id: req.debtor.alias,
        },
        creditor: {
          name: req.creditor.name ?? 'Unknown',
          country: undefined,
          account_id: req.creditor.alias,
        },
        alias: { type: 'LLAVE_BREB' as const, value: creditorLlave },
        purpose: req.purpose ?? (tipoLlave === 'NIT' ? 'SUPP' : 'P2P'),
        reference: req.reference ?? `BREB-${ulid()}`,
        status: 'RECEIVED',
        trace_id: traceId,
      };
    }

    const result = canonicalPacs008Schema.safeParse(raw);
    if (!result.success) {
      log.error({ errors: result.error.flatten() }, 'Bre-B → Canonical validation failed');
      throw new TranslationError('BRE_B', 'Invalid canonical output from Bre-B translation', {
        zodErrors: result.error.flatten().fieldErrors,
      });
    }

    log.info('Bre-B → Canonical translation complete');
    return result.data;
  } catch (err) {
    if (err instanceof TranslationError) throw err;
    log.error({ err }, 'Unexpected error in brebToCanonical');
    throw new TranslationError('BRE_B', 'Unexpected error during Bre-B translation', { cause: err });
  }
}
