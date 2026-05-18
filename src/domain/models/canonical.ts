import { z } from 'zod';

/** All rails supported by the MIPIT translation layer */
export const SUPPORTED_RAILS = ['PIX', 'SPEI', 'SWIFT_MT103', 'ISO20022_MX', 'ACH_NACHA', 'FEDNOW', 'BRE_B'] as const;
export type SupportedRail = typeof SUPPORTED_RAILS[number];

/** Alias type enum aligned with constants.ts */
export const ALIAS_TYPE_ENUM = ['PIX_KEY', 'CLABE', 'IBAN', 'ACCOUNT', 'ABA_ROUTING', 'BIC', 'LLAVE_BREB'] as const;

/**
 * Payment lifecycle status enum.
 * Source of truth for valid status values; the DB CHECK constraint mirrors this
 * (mipit-infra/db/migrations/008_payments_constraints_and_iso.sql).
 */
export const PAYMENT_STATUS_ENUM = [
  'RECEIVED',
  'VALIDATED',
  'CANONICALIZED',
  'NORMALIZED',
  'ROUTED',
  'QUEUED',
  'SENT_TO_DESTINATION',
  'ACKED_BY_RAIL',
  'COMPLETED',
  'FAILED',
  'REJECTED',
  'DUPLICATE',
  'COMPENSATING',
  'COMPENSATED',
  'DEAD_LETTER',
] as const;
export type PaymentStatus = typeof PAYMENT_STATUS_ENUM[number];

/** ISO 20022 ChrgBr (Charge Bearer) — who pays the charges. */
export const CHARGE_BEARER_ENUM = ['DEBT', 'CRED', 'SHAR', 'SLEV'] as const;
export type ChargeBearer = typeof CHARGE_BEARER_ENUM[number];

/**
 * MiPIT Internal Canonical Model — pacs.008-derived (JSON subset, NOT a strict
 * pacs.008.001.10 implementation).
 *
 * See `mipit-docs/adrs/ADR-002-canonical-pacs008-json.md` (Limitations section)
 * for the explicit list of pacs.008 elements not implemented.
 *
 * Mandatory ISO v10 fields modeled here:
 *   - PmtId.{InstrId, EndToEndId, TxId, UETR}
 *   - IntrBkSttlmAmt (value + currency)
 *   - IntrBkSttlmDt
 *   - ChrgBr (DEBT/CRED/SHAR/SLEV)
 *
 * Optional CBPR+ fields modeled here:
 *   - GrpHdr.InitgPty (initiating party name)
 *   - GrpHdr.CtrlSum
 *   - GrpHdr.TtlIntrBkSttlmAmt
 *   - GrpHdr.SttlmInf.ClrSys.Cd (e.g. USABA, CHATS)
 */
export const canonicalPacs008Schema = z.object({
  payment_id: z.string().regex(/^PMT-[A-Z0-9]{10,40}$/),
  created_at: z.string().datetime(),

  grpHdr: z.object({
    msgId: z.string().max(35),
    creDtTm: z.string().datetime(),
    /** Number of transactions in the message (always 1 for MIPIT PoC) */
    nbOfTxs: z.number().int().positive().optional(),
    /** Optional: control sum (sum of all instructed amounts in this batch). */
    ctrlSum: z.number().nonnegative().optional(),
    /** Optional: total interbank settlement amount across the batch. */
    ttlIntrBkSttlmAmt: z
      .object({
        value: z.number().nonnegative(),
        currency: z.string().length(3),
      })
      .optional(),
    /** Optional: initiating party (CBPR+). */
    initgPty: z
      .object({
        name: z.string().max(140).optional(),
        id: z.string().max(35).optional(),
        ctryOfRes: z.string().length(2).optional(),
      })
      .optional(),
    /** Settlement information (optional — defaults to CLRG when omitted). */
    sttlmInf: z
      .object({
        sttlmMtd: z.enum(['INDA', 'INGA', 'COVE', 'CLRG']).default('CLRG'),
        /** Clearing system code (e.g. USABA for FedNow, BACEN for PIX). */
        clrSys: z
          .object({
            cd: z.string().max(5).optional(),
            prtry: z.string().max(35).optional(),
          })
          .optional(),
      })
      .optional(),
  }),

  pmtId: z.object({
    /**
     * End-to-End ID. Per pacs.008.001.10, MANDATORY [1..1]. Max length 35.
     * Per-rail format: e.g. PIX requires `E + ISPB(8) + YYYYMMDDHHMM(BRT) + 11 alnum` = 32 chars.
     */
    endToEndId: z.string().max(35),
    /** Instruction ID (optional, used in SWIFT/ISO 20022). Per spec [0..1]. */
    instrId: z.string().max(35).optional(),
    /** Transaction ID. Per pacs.008.001.10 [1..1] MANDATORY (pipeline stamps). */
    txId: z.string().max(35).optional(),
    /**
     * UETR — Unique End-to-End Transaction Reference (UUIDv4).
     * Per pacs.008.001.10 [1..1] MANDATORY (CBPR+ rule). The pipeline stamps
     * this in step 1 of `executePipeline`; translators don't need to populate.
     */
    uetr: z.string().uuid().optional(),
  }),

  /**
   * ChrgBr — Charge Bearer. Per pacs.008.001.10 [1..1] MANDATORY.
   * Translators may omit; the pipeline always stamps to 'SLEV' (service level —
   * appropriate for instant rails) before persistence/publish.
   *   DEBT = Borne by Debtor
   *   CRED = Borne by Creditor
   *   SHAR = Shared
   *   SLEV = Service Level
   */
  chrgBr: z.enum(CHARGE_BEARER_ENUM).optional(),

  /**
   * Interbank Settlement Date (ISODate, YYYY-MM-DD).
   * Per pacs.008.001.10 [1..1] MANDATORY at the CdtTrfTxInf level. The pipeline
   * stamps this; translators may omit.
   */
  intrBkSttlmDt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),

  /**
   * W6.5 — LclInstrm.Prtry: local instrument code. Tells the destination
   * how to route the payment (RTGS vs instant vs same-day). CBPR+ §4.10
   * + ISO 20022 ExternalLocalInstrument1Code. Per-rail conventions used by
   * MIPIT: PIX='PIX', SPEI='SPEI', BRE_B='BREB', FedNow='INST', NACHA='WEB'.
   * Optional in the schema because translators add the right one for their
   * outbound rail; the canonical only persists if the inbound translator
   * captured one.
   */
  lclInstrm: z
    .object({
      cd: z.string().max(4).optional(),
      prtry: z.string().max(35).optional(),
    })
    .optional(),

  /**
   * W6.3 — CtgyPurp.Cd: Category Purpose per ISO 20022
   * `ExternalCategoryPurpose1Code`. Distinguishes semantic intent
   * (P2P/SALA/CASH/INTC/TAXS/SUPP/...) so destination rails can use the
   * correct local instruction class. Example mapping:
   *   PIX.tipo='TRANSF'  → ctgyPurp='CASH'  → SPEI.tipoPago=1 (tercero-a-tercero)
   *   purpose='SALARY'   → ctgyPurp='SALA'  → SPEI.tipoPago=5 (nómina)
   *   purpose='TAX'      → ctgyPurp='TAXS'  → SPEI.tipoPago=14 (impuesto federal)
   * Without this, SPEI mapper hardcoded `tipoPago: 1`, losing semantic info
   * for the Hacienda audit trail.
   */
  ctgyPurp: z.string().max(4).optional(),

  amount: z.object({
    value: z.number().positive(),
    currency: z.string().length(3),
    /** Original instructed amount (before FX) — InstdAmt in ISO 20022. */
    instdAmt: z.number().positive().optional(),
    instdAmtCcy: z.string().length(3).optional(),
  }),

  fx: z
    .object({
      source_currency: z.string().length(3).optional(),
      target_currency: z.string().length(3).optional(),
      rate: z.number().positive().optional(),
      local_amount: z.number().positive().optional(),
      via: z.enum(['direct', 'usd']).optional(),
      source_provider: z.string().optional(),
      timestamp: z.string().datetime().optional(),
    })
    .optional(),

  origin: z.object({
    rail: z.enum(SUPPORTED_RAILS),
    /** BIC of the originating financial institution */
    bic: z.string().max(11).optional(),
    /** ABA routing number (for ACH/FedNow) */
    routingNumber: z.string().length(9).optional(),
    /** ISPB (for PIX — 8 digits BACEN-assigned) */
    ispb: z.string().length(8).optional(),
    /** Institution code (for SPEI — 5-digit BANXICO catalog) */
    institutionCode: z.string().max(8).optional(),
  }),

  destination: z.object({
    rail: z.enum(SUPPORTED_RAILS).optional(),
    /** BIC of the creditor agent */
    bic: z.string().max(11).optional(),
    /** ABA routing number (for ACH/FedNow) */
    routingNumber: z.string().length(9).optional(),
    /** ISPB (for PIX) */
    ispb: z.string().length(8).optional(),
    /** Institution code (for SPEI) */
    institutionCode: z.string().max(8).optional(),
  }),

  debtor: z.object({
    name: z.string().max(140).optional(),
    country: z.string().length(2).optional(),
    account_id: z.string(),
    /** Tax ID: CPF/CNPJ (Brazil), RFC/CURP (Mexico), SSN/EIN (USA), NIT/CC (Colombia) */
    taxId: z.string().optional(),
    /** Account type: CACC (checking), SVGS (savings), TRAN (payment), SLRY (salary) */
    accountType: z.enum(['CACC', 'SVGS', 'TRAN', 'SLRY']).optional(),
    /** Agent branch */
    agencia: z.string().optional(),
    /** Email for contact */
    email: z.string().optional(),
    /** Phone number */
    phone: z.string().optional(),
    /** Address lines */
    address: z.array(z.string().max(70)).max(4).optional(),
  }),

  creditor: z.object({
    name: z.string().max(140).optional(),
    country: z.string().length(2).optional(),
    account_id: z.string(),
    taxId: z.string().optional(),
    accountType: z.enum(['CACC', 'SVGS', 'TRAN', 'SLRY']).optional(),
    agencia: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    address: z.array(z.string().max(70)).max(4).optional(),
  }),

  alias: z.object({
    type: z.enum(ALIAS_TYPE_ENUM),
    value: z.string(),
  }),

  /** Purpose code: P2P, SUPP (supplier), SALA (salary), GOVT, TAXS */
  purpose: z.string().max(35).default('P2P'),
  reference: z.string().max(140).default('MIPIT-POC'),
  /** Free-form remittance information (up to 4 × 35 chars = 140) */
  remittanceInfo: z.string().max(140).optional(),

  status: z.enum(PAYMENT_STATUS_ENUM),
  trace_id: z.string().optional(),

  /**
   * Embedded rail acknowledgement. Shape is legacy (kept for backward
   * compatibility with adapters that emit the simpler ACK).
   * Prefer reading from `Pacs002Ack` (canonical/pacs002.schema.ts) on the
   * consumer side, which carries proper ISO 20022 TxSts codes.
   */
  rail_ack: z
    .object({
      rail_tx_id: z.string().optional(),
      status: z.enum(['ACCEPTED', 'REJECTED', 'ERROR', 'PENDING']).optional(),
      error: z
        .object({
          code: z.string(),
          message: z.string(),
        })
        .optional(),
    })
    .optional()
    .nullable(),
});

export type CanonicalPacs008 = z.infer<typeof canonicalPacs008Schema>;
