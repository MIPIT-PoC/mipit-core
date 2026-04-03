import { ulid } from 'ulid';
import { canonicalPacs008Schema, type CanonicalPacs008 } from '../domain/models/canonical.js';
import { TranslationError } from '../domain/errors/index.js';
import { logger } from '../observability/logger.js';

/**
 * SWIFT MT103 structured representation.
 * The real MT103 is a text block format (SWIFT FIN); this interface represents
 * the parsed/deserialized form used by modern API gateways and SWIFT MX migration tools.
 *
 * Reference: SWIFT Standards MT103 (Single Customer Credit Transfer)
 */
export interface SwiftMt103Message {
  /** :20: Transaction Reference Number (max 16 chars, alphanumeric + /- ) */
  transactionRef: string;

  /** :23B: Bank Operation Code (CRED = credit transfer, CRTS = credit to sender) */
  bankOperationCode: 'CRED' | 'CRTS' | 'SPAY' | 'SPRI' | 'SSTD';

  /**
   * :32A: Value Date, Currency, Amount
   * Date in YYMMDD, currency ISO 4217, amount with comma as decimal separator
   */
  valueDate: string;      // YYYY-MM-DD ISO
  currency: string;       // ISO 4217
  amount: number;

  /**
   * :50A: or :50K: Ordering Customer (debtor)
   * :50A = BIC + account
   * :50K = account/name (free format, up to 4 lines of 35 chars)
   */
  orderingCustomer: {
    account?: string;
    name?: string;
    address?: string[];
    bic?: string;
  };

  /**
   * :52A: or :52D: Ordering Institution (debtor's bank) [optional]
   */
  orderingInstitution?: {
    bic?: string;
    name?: string;
    address?: string[];
  };

  /**
   * :57A: or :57D: Account With Institution (creditor's bank)
   */
  accountWithInstitution?: {
    bic?: string;
    name?: string;
    address?: string[];
  };

  /**
   * :59: or :59A: Beneficiary Customer (creditor)
   * :59  = account/name (free format)
   * :59A = IBAN + BIC
   */
  beneficiaryCustomer: {
    account?: string;  // IBAN or account number
    iban?: string;
    name?: string;
    address?: string[];
  };

  /**
   * :70: Remittance Information (up to 4 × 35 chars)
   */
  remittanceInfo?: string;

  /**
   * :71A: Details of Charges
   * OUR = sender pays all fees
   * SHA = shared fees (most common)
   * BEN = beneficiary pays all fees
   */
  detailsOfCharges?: 'OUR' | 'SHA' | 'BEN';

  /** :72: Sender to Receiver Information [optional] */
  senderToReceiverInfo?: string;

  /** Raw MT103 string (for traceability) */
  rawMessage?: string;
}

/**
 * Parses a raw SWIFT MT103 FIN message text into a structured object.
 * Supports the standard block format used in SWIFT FIN messaging.
 */
export function parseMt103(raw: string): SwiftMt103Message {
  // Extract the body from {4:...-} block
  const bodyMatch = raw.match(/\{4:([\s\S]*?)-\}/);
  const body = bodyMatch ? bodyMatch[1] : raw;

  const getField = (tag: string): string | undefined => {
    const regex = new RegExp(`:${tag}:([\\s\\S]*?)(?=:\\d{2}[A-Z]?:|$|-\})`, 'i');
    const match = body.match(regex);
    return match ? match[1].trim() : undefined;
  };

  const getMultilineField = (tag: string): string[] => {
    const raw = getField(tag);
    return raw ? raw.split('\n').map(l => l.trim()).filter(Boolean) : [];
  };

  // :20: Transaction Reference
  const transactionRef = getField('20') ?? `MT103-${ulid().substring(0, 16)}`;

  // :23B: Bank Operation Code
  const opCode = (getField('23B') ?? 'CRED') as SwiftMt103Message['bankOperationCode'];

  // :32A: Value Date, Currency, Amount (format: YYMMDD + CCY + amount with comma)
  const field32 = getField('32A') ?? '';
  const match32 = field32.match(/^(\d{6})([A-Z]{3})([\d,]+)$/);
  const rawDate = match32 ? match32[1] : new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const currency = match32 ? match32[2] : 'USD';
  const amountStr = match32 ? match32[3].replace(',', '.') : '0';
  const amount = parseFloat(amountStr);

  // Parse YYMMDD → YYYY-MM-DD
  const year = parseInt(rawDate.slice(0, 2), 10);
  const valueDate = `${year >= 70 ? '19' : '20'}${rawDate.slice(0, 2)}-${rawDate.slice(2, 4)}-${rawDate.slice(4, 6)}`;

  // :50K: or :50A: Ordering Customer
  const field50K = getMultilineField('50K');
  const field50A = getField('50A');
  const orderingCustomer: SwiftMt103Message['orderingCustomer'] = {};
  if (field50A) {
    const parts50A = field50A.split('\n');
    orderingCustomer.bic = parts50A[0]?.startsWith('/') ? undefined : parts50A[0]?.trim();
    orderingCustomer.account = parts50A[0]?.startsWith('/') ? parts50A[0].slice(1).trim() : parts50A[1]?.trim();
  } else if (field50K.length > 0) {
    orderingCustomer.account = field50K[0]?.startsWith('/') ? field50K[0].slice(1) : field50K[0];
    orderingCustomer.name = field50K[1];
    orderingCustomer.address = field50K.slice(2);
  }

  // :57A: Account With Institution (creditor bank)
  const field57A = getField('57A');
  const accountWithInstitution: SwiftMt103Message['accountWithInstitution'] = field57A
    ? { bic: field57A.trim() }
    : undefined;

  // :59: or :59A: Beneficiary Customer
  const field59 = getMultilineField('59');
  const field59A = getField('59A');
  const beneficiaryCustomer: SwiftMt103Message['beneficiaryCustomer'] = {};
  if (field59A) {
    const parts = field59A.trim().split('\n');
    beneficiaryCustomer.iban = parts[0]?.startsWith('/') ? parts[0].slice(1).trim() : undefined;
    beneficiaryCustomer.name = parts[1]?.trim();
  } else if (field59.length > 0) {
    beneficiaryCustomer.account = field59[0]?.startsWith('/') ? field59[0].slice(1) : field59[0];
    beneficiaryCustomer.name = field59[1];
    beneficiaryCustomer.address = field59.slice(2);
  }

  // :70: Remittance Information
  const remittanceInfo = getField('70');

  // :71A: Details of Charges
  const charges = getField('71A') as SwiftMt103Message['detailsOfCharges'] | undefined;

  return {
    transactionRef,
    bankOperationCode: opCode,
    valueDate,
    currency,
    amount,
    orderingCustomer,
    accountWithInstitution,
    beneficiaryCustomer,
    remittanceInfo,
    detailsOfCharges: charges,
    rawMessage: raw,
  };
}

/**
 * Translates a SWIFT MT103 message (structured) to the canonical pacs.008 model.
 */
export async function swiftMt103ToCanonical(
  payload: SwiftMt103Message | string,
  paymentId: string,
  traceId?: string,
): Promise<CanonicalPacs008> {
  const log = logger.child({ payment_id: paymentId, rail: 'SWIFT_MT103' });

  try {
    // If a raw string was passed, parse it first
    const msg: SwiftMt103Message = typeof payload === 'string' ? parseMt103(payload) : payload;

    const now = new Date().toISOString();

    const debtorAccount = msg.orderingCustomer.account ?? msg.orderingCustomer.name ?? 'UNKNOWN';
    const creditorAccount = msg.beneficiaryCustomer.iban
      ?? msg.beneficiaryCustomer.account
      ?? msg.beneficiaryCustomer.name
      ?? 'UNKNOWN';

    const raw = {
      payment_id: paymentId,
      created_at: now,
      grpHdr: {
        msgId: `MSG-${ulid()}`,
        creDtTm: now,
        nbOfTxs: 1,
      },
      pmtId: {
        endToEndId: msg.transactionRef.substring(0, 35),
        instrId: msg.transactionRef,
      },
      amount: {
        value: msg.amount,
        currency: msg.currency.toUpperCase(),
      },
      origin: {
        rail: 'SWIFT_MT103' as const,
        bic: msg.orderingInstitution?.bic ?? msg.orderingCustomer.bic,
      },
      destination: {
        rail: undefined,
        bic: msg.accountWithInstitution?.bic,
      },
      debtor: {
        name: msg.orderingCustomer.name?.substring(0, 140),
        country: extractCountryFromAddress(msg.orderingCustomer.address),
        account_id: debtorAccount,
        address: msg.orderingCustomer.address?.slice(0, 4),
      },
      creditor: {
        name: msg.beneficiaryCustomer.name?.substring(0, 140),
        country: extractCountryFromAddress(msg.beneficiaryCustomer.address),
        account_id: creditorAccount,
        address: msg.beneficiaryCustomer.address?.slice(0, 4),
      },
      alias: {
        type: msg.beneficiaryCustomer.iban ? ('IBAN' as const) : ('ACCOUNT' as const),
        value: creditorAccount,
      },
      purpose: 'P2P',
      reference: msg.transactionRef,
      remittanceInfo: msg.remittanceInfo?.substring(0, 140),
      status: 'RECEIVED',
      trace_id: traceId,
    };

    const result = canonicalPacs008Schema.safeParse(raw);
    if (!result.success) {
      log.error({ errors: result.error.flatten() }, 'SWIFT MT103 → Canonical validation failed');
      throw new TranslationError('SWIFT_MT103', 'Invalid canonical output from SWIFT MT103 translation', {
        zodErrors: result.error.flatten().fieldErrors,
      });
    }

    log.info('SWIFT MT103 → Canonical translation complete');
    return result.data;
  } catch (err) {
    if (err instanceof TranslationError) throw err;
    log.error({ err }, 'Unexpected error in swiftMt103ToCanonical');
    throw new TranslationError('SWIFT_MT103', 'Unexpected error during MT103 translation', { cause: err });
  }
}

/** Extracts a 2-letter country code from the last address line if it looks like one */
function extractCountryFromAddress(address?: string[]): string | undefined {
  if (!address || address.length === 0) return undefined;
  const last = address[address.length - 1];
  // Country codes sometimes appear as "US", "MX", or at the end of "New York US"
  const match = last?.match(/\b([A-Z]{2})\s*$/);
  return match ? match[1] : undefined;
}
