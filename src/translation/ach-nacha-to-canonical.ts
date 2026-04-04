import { ulid } from 'ulid';
import { canonicalPacs008Schema, type CanonicalPacs008 } from '../domain/models/canonical.js';
import { TranslationError } from '../domain/errors/index.js';
import { logger } from '../observability/logger.js';

/**
 * ACH NACHA structured representation.
 * NACHA (National Automated Clearing House Association) is the US ACH network operator.
 * Files are fixed-width ASCII records (94 chars per line).
 *
 * Record types:
 *   1 - File Header
 *   5 - Batch Header
 *   6 - Entry Detail
 *   7 - Addenda (optional, for additional info)
 *   8 - Batch Control
 *   9 - File Control
 *
 * Reference: NACHA Operating Rules & Procedures (2024 edition)
 */

/** NACHA ACH transaction codes */
export type AchTransactionCode =
  | 22  // Checking account credit (PPD/CCD)
  | 23  // Prenote for checking credit
  | 27  // Checking account debit
  | 28  // Prenote for checking debit
  | 32  // Savings account credit
  | 33  // Prenote for savings credit
  | 37  // Savings account debit
  | 38; // Prenote for savings debit

/** NACHA Standard Entry Class codes */
export type AchSecCode =
  | 'PPD'  // Prearranged Payment and Deposit (consumer accounts)
  | 'CCD'  // Corporate Credit or Debit (business accounts)
  | 'CTX'  // Corporate Trade Exchange (business with addenda)
  | 'WEB'  // Internet-initiated debit entries
  | 'TEL'  // Telephone-initiated debit entries
  | 'IAT'; // International ACH Transaction

/**
 * ACH NACHA Entry Detail Record (Type 6)
 * Represents a single ACH credit or debit transaction.
 */
export interface AchEntryDetail {
  /** Record type = '6' */
  recordType: '6';

  /**
   * Transaction Code determines account type and credit/debit:
   *   22 = Checking account credit (deposit)
   *   27 = Checking account debit (withdrawal)
   *   32 = Savings account credit
   *   37 = Savings account debit
   */
  transactionCode: AchTransactionCode;

  /**
   * RDFI Routing Transit Number (9 digits) — Receiving Depository Financial Institution
   * The first 8 digits are the ABA routing number, the 9th is the check digit.
   */
  routingTransitNumber: string;  // 9 digits

  /**
   * DFI Account Number — up to 17 characters (left-justified, space-padded)
   * The receiver's account number at the RDFI.
   */
  accountNumber: string;  // max 17 chars

  /**
   * Dollar Amount — cents (integer), no decimal point
   * e.g. $1,234.56 = 123456
   */
  amount: number;  // in cents

  /** Individual ID Number — up to 15 chars (used for consumer identification) */
  individualIdNumber?: string;

  /** Individual Name — up to 22 chars (receiver's name) */
  individualName: string;

  /**
   * Discretionary Data — 2 chars (used by ODFI internally, often spaces)
   */
  discretionaryData?: string;

  /** Addenda Record Indicator — '0' = no addenda, '1' = has addenda */
  addendaRecordIndicator: '0' | '1';

  /** RDFI Trace Number — 15 digits (usually assigned by ODFI) */
  traceNumber?: string;
}

/**
 * ACH NACHA Batch Header Record (Type 5)
 */
export interface AchBatchHeader {
  recordType: '5';

  /** Service Class Code: 200=mixed, 220=credits only, 225=debits only */
  serviceClassCode: '200' | '220' | '225';

  /** Company Name — up to 16 chars */
  companyName: string;

  /** Company Identification — 10 chars (IRS EIN or CCD identifier) */
  companyId: string;

  /** Standard Entry Class Code */
  secCode: AchSecCode;

  /** Company Entry Description — up to 10 chars (e.g. "PAYROLL", "RENT") */
  companyEntryDescription: string;

  /** Company Descriptive Date — YYMMDD or free text (up to 6 chars) */
  companyDescriptiveDate?: string;

  /** Effective Entry Date — YYMMDD (settlement date) */
  effectiveEntryDate: string;

  /**
   * Originating DFI Identification — 8 digits (ODFI routing without check digit)
   */
  originatingDfiId: string;

  /** Batch Number — 7 digits */
  batchNumber: string;
}

/**
 * Complete ACH NACHA transaction (batch header + entry detail + optional addenda)
 * This structured representation covers the information needed for canonical translation.
 */
export interface AchNachaTransaction {
  batchHeader: AchBatchHeader;
  entryDetail: AchEntryDetail;

  /**
   * Optional addenda records (up to 9999 for CTX).
   * For IAT, the addenda contains the SWIFT-like routing info.
   */
  addenda?: Array<{
    recordType: '7';
    addendaTypeCode: string;
    paymentRelatedInfo: string;
    addendaSequence: string;
    traceNumber: string;
  }>;

  /** ODFI information */
  odfi: {
    name: string;
    routingNumber: string;   // 9-digit ABA
    city?: string;
    state?: string;
    countryCode?: string;
  };

  /** Originator (debtor) information */
  originator: {
    name: string;
    accountNumber: string;
    routingNumber: string;
    taxId?: string;
  };
}

/**
 * Translates an ACH NACHA transaction to the canonical pacs.008 model.
 */
export async function achNachaToCanonical(
  payload: AchNachaTransaction | Record<string, unknown>,
  paymentId: string,
  traceId?: string,
): Promise<CanonicalPacs008> {
  const log = logger.child({ payment_id: paymentId, rail: 'ACH_NACHA' });

  try {
    const txn = payload as AchNachaTransaction;
    const entry = txn.entryDetail;
    const batch = txn.batchHeader;
    const originator = txn.originator;

    const now = new Date().toISOString();
    const amountUsd = entry.amount / 100; // Convert cents to dollars

    // Trace number = unique reference
    const traceNumber = entry.traceNumber
      ?? `${batch.originatingDfiId}${Math.floor(Math.random() * 99999999).toString().padStart(7, '0')}`;

    const raw = {
      payment_id: paymentId,
      created_at: now,
      grpHdr: {
        msgId: `MSG-${ulid()}`,
        creDtTm: now,
        nbOfTxs: 1,
      },
      pmtId: {
        endToEndId: traceNumber.substring(0, 35),
        instrId: `${batch.companyId}-${batch.batchNumber}`.substring(0, 35),
      },
      amount: {
        value: amountUsd,
        currency: 'USD',
      },
      origin: {
        rail: 'ACH_NACHA' as const,
        routingNumber: batch.originatingDfiId.substring(0, 9).padEnd(9, '0'),
        bic: undefined,
      },
      destination: {
        rail: undefined,
        routingNumber: entry.routingTransitNumber.substring(0, 9),
        bic: undefined,
      },
      debtor: {
        name: (originator?.name ?? batch.companyName).substring(0, 140),
        country: 'US',
        account_id: originator?.accountNumber ?? batch.companyId,
        taxId: originator?.taxId,
      },
      creditor: {
        name: entry.individualName.trim().substring(0, 140),
        country: 'US',
        account_id: entry.accountNumber.trim(),
      },
      alias: {
        type: 'ABA_ROUTING' as const,
        value: `${entry.routingTransitNumber.substring(0, 9)}/${entry.accountNumber.trim()}`,
      },
      purpose: batch.companyEntryDescription.trim().substring(0, 35) || 'P2P',
      reference: `${batch.companyId}-${batch.batchNumber}`,
      remittanceInfo: txn.addenda?.[0]?.paymentRelatedInfo?.substring(0, 140),
      status: 'RECEIVED',
      trace_id: traceId,
    };

    const result = canonicalPacs008Schema.safeParse(raw);
    if (!result.success) {
      log.error({ errors: result.error.flatten() }, 'ACH NACHA → Canonical validation failed');
      throw new TranslationError('ACH_NACHA', 'Invalid canonical output from ACH NACHA translation', {
        zodErrors: result.error.flatten().fieldErrors,
      });
    }

    log.info('ACH NACHA → Canonical translation complete');
    return result.data;
  } catch (err) {
    if (err instanceof TranslationError) throw err;
    log.error({ err }, 'Unexpected error in achNachaToCanonical');
    throw new TranslationError('ACH_NACHA', 'Unexpected error during ACH NACHA translation', { cause: err });
  }
}
