import { ulid } from 'ulid';
import { canonicalPacs008Schema, type CanonicalPacs008 } from '../domain/models/canonical.js';
import { TranslationError } from '../domain/errors/index.js';
import { logger } from '../observability/logger.js';

/**
 * Bre-B (Banco de la República — Colombia) Payment Message
 *
 * !!! IMPORTANT — MOCK FIDELITY DISCLOSURE (W5.13) !!!
 * BanRep had not published a public wire-format specification at the time
 * this module was written. The field names, error codes (BREB001–005), the
 * REST endpoint layout, and the 8-digit codigoEntidad below are EDUCATED
 * GUESSES based on TR-002 high-level docs and Superfinanciera conventions —
 * they are NOT BanRep-verified. See `mipit-docs/LIMITATIONS.md` §1.
 *
 * Real BanRep TR-002 v1.1 (Oct 2025) actually uses 4-digit Superfinanciera
 * codes (see `mipit-adapter-breb/src/breb/types.ts:105-122` for the official
 * catalogue) and references ISO 20022 ExternalStatusReason1Code values, not
 * the proprietary BREB001-005 we invented for this PoC.
 *
 * Key identifiers (PoC convention):
 *   - codigoEntidad: 8-digit code (LEGACY — replaced by 4-digit in adapter)
 *   - llave: alias — phone (+573…), NIT, email, or `@alias` string
 *   - tipoLlave: TELEFONO | NIT | EMAIL | ALIAS
 *   - idTransaccion: BR + entity(8) + YYYYMMDD(8) + HHmm(4) + unique(10) = 32 chars
 *   - Currency: always COP (Colombian Peso, integer — no centavos)
 *
 * Error codes (MIPIT-invented, NOT BanRep-published — pending mapping to
 * ISO 20022 ExternalStatusReason1Code; see audits/AUDITORIA-2-2026-05-17.md R-010):
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

/**
 * Colombian financial institution codes — 4 digits per Superintendencia
 * Financiera de Colombia, the catalogue BanRep Bre-B TR-002 §3.1 references.
 *
 * W6.7 — unified to the 4-digit catalogue. The previous 8-digit codes
 * (BANCOLOMBIA `00000007`, etc.) were PoC-invented zero-padded versions
 * and diverged from the adapter's `SUPERFIN_ENTITY_CODES`. A real BanRep
 * sandbox would reject the 8-digit form.
 *
 * Mirror of `mipit-adapter-breb/src/breb/types.ts:SUPERFIN_ENTITY_CODES`.
 */
export const BREB_ENTITY_CODES = {
  BANCOLOMBIA:       '0007',
  BANCO_DE_BOGOTA:   '0001',
  BBVA_COLOMBIA:     '0013',
  DAVIVIENDA:        '0051',
  BANCAMIA:          '0059',
  NEQUI:             '5070',  // SEDPE
  DAVIPLATA:         '0051',  // operada por Davivienda
  FINTECH_SIMULATED: '9999',  // out-of-catalogue MIPIT sim code
} as const;

/**
 * Generates a valid Bre-B idTransaccion.
 * Format: BR + codigoEntidad(4 or 8) + YYYYMMDD(8) + HHmm(4) + unique(10)
 *   → 28 chars total when codigoEntidad is 4-digit (W6.7 default)
 *   → 32 chars total when codigoEntidad is the legacy 8-digit form (kept for
 *     back-compat). The adapter mock accepts both forms.
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

/**
 * Infer alias type from the llave value — unified with the adapter
 * (`mipit-adapter-breb/src/breb/mapper.ts:73-81`) per W6.8.
 *
 * Rules (TR-002 informed):
 *   - TELEFONO: `+573xxxxxxxxx` (mobile-only, 10 digits after +57 starting with 3)
 *   - NIT:      `\d{9,10}-\d` (DIAN format with check digit)
 *   - ALIAS:    `@<3-19 alnum/._>` — must start with `@` (BanRep convention)
 *   - EMAIL:    standard RFC pattern with `.` and TLD
 *   - everything else falls back to ALIAS so the adapter, which is the
 *     authoritative validator, can re-classify or reject. Previously this
 *     function classified anything with `@` as EMAIL (catching e.g. `@juan` too),
 *     and anything else as ALIAS — but a numeric string like `1234567890` was
 *     ALIAS at the core and CC at the adapter, causing post-translation rejects.
 */
function inferTipoLlave(llave: string): BreBKeyType {
  if (/^\+573\d{9}$/.test(llave)) return 'TELEFONO';
  if (/^\d{9,10}-\d$/.test(llave)) return 'NIT';
  if (/^@[a-zA-Z0-9._]{3,19}$/.test(llave)) return 'ALIAS';
  if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(llave)) return 'EMAIL';
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
