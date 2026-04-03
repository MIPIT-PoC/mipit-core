import { z } from 'zod';

/** All rails supported by the MIPIT translation layer */
export const SUPPORTED_RAILS = ['PIX', 'SPEI', 'SWIFT_MT103', 'ISO20022_MX', 'ACH_NACHA', 'FEDNOW', 'BRE_B'] as const;
export type SupportedRail = typeof SUPPORTED_RAILS[number];

/** Alias type enum aligned with constants.ts */
export const ALIAS_TYPE_ENUM = ['PIX_KEY', 'CLABE', 'IBAN', 'ACCOUNT', 'ABA_ROUTING', 'BIC', 'LLAVE_BREB'] as const;

/**
 * Canonical model based on ISO 20022 pacs.008 (FIToFICustomerCreditTransfer).
 * All rails translate TO and FROM this format.
 */
export const canonicalPacs008Schema = z.object({
  payment_id: z.string().regex(/^PMT-[A-Z0-9]{10,32}$/),
  created_at: z.string().datetime(),

  grpHdr: z.object({
    msgId: z.string(),
    creDtTm: z.string().datetime(),
    /** Number of transactions in the message (always 1 for MIPIT PoC) */
    nbOfTxs: z.number().int().positive().default(1),
    /** Settlement information */
    sttlmInf: z.object({
      sttlmMtd: z.enum(['INDA', 'INGA', 'COVE', 'CLRG']).default('CLRG'),
    }).optional(),
  }),

  pmtId: z.object({
    /** End-to-End ID: unique per rail (E2E-ULID for canonical, E{ISPB}{date}{unique} for PIX SPI) */
    endToEndId: z.string().max(35),
    /** Instruction ID (optional, used in SWIFT/ISO 20022) */
    instrId: z.string().max(35).optional(),
    /** Transaction ID (optional, used in FedNow/ISO 20022) */
    txId: z.string().max(35).optional(),
  }),

  amount: z.object({
    value: z.number().positive(),
    currency: z.string().length(3),
    /** Original instructed amount (before FX) */
    instdAmt: z.number().positive().optional(),
    instdAmtCcy: z.string().length(3).optional(),
  }),

  fx: z
    .object({
      source_currency: z.string().length(3).optional(),
      target_currency: z.string().length(3).optional(),
      rate: z.number().positive().optional(),
      local_amount: z.number().positive().optional(),
    })
    .optional(),

  origin: z.object({
    rail: z.enum(SUPPORTED_RAILS),
    /** BIC of the originating financial institution */
    bic: z.string().max(11).optional(),
    /** ABA routing number (for ACH/FedNow) */
    routingNumber: z.string().length(9).optional(),
    /** ISPB (for PIX) */
    ispb: z.string().length(8).optional(),
    /** Institution code (for SPEI - BANXICO codes) */
    institutionCode: z.string().max(5).optional(),
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
    institutionCode: z.string().max(5).optional(),
  }),

  debtor: z.object({
    name: z.string().max(140).optional(),
    country: z.string().length(2).optional(),
    account_id: z.string(),
    /** Tax ID: CPF/CNPJ (Brazil), RFC/CURP (Mexico), SSN/EIN (USA) */
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

  status: z.string(),
  trace_id: z.string().optional(),

  rail_ack: z
    .object({
      rail_tx_id: z.string().optional(),
      status: z.enum(['ACCEPTED', 'REJECTED', 'ERROR']).optional(),
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
