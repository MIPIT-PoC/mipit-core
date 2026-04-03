import type { CanonicalPacs008 } from '../domain/models/canonical.js';
import { logger } from '../observability/logger.js';
import type { SwiftMt103Message } from './swift-mt103-to-canonical.js';

/**
 * Converts the canonical pacs.008 model to a SWIFT MT103 structured message.
 * Follows SWIFT MT103 field specifications for FIN messaging.
 */
export async function canonicalToSwiftMt103(canonical: CanonicalPacs008): Promise<SwiftMt103Message> {
  const log = logger.child({ payment_id: canonical.payment_id, destination: 'SWIFT_MT103' });

  // Format the value date as YYMMDD (MT103 :32A: format)
  const isoDate = canonical.created_at.slice(0, 10); // YYYY-MM-DD
  const valueDate = isoDate; // We keep ISO for the structured object

  const creditorAccount = canonical.creditor.account_id;
  const debtorAccount = canonical.debtor.account_id;

  // Determine if creditor account is IBAN
  const isIban = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(creditorAccount);

  const msg: SwiftMt103Message = {
    transactionRef: canonical.pmtId.endToEndId.substring(0, 16).replace(/[^A-Z0-9/-]/gi, 'X'),
    bankOperationCode: 'CRED',
    valueDate,
    currency: canonical.amount.currency,
    amount: canonical.amount.value,

    orderingCustomer: {
      account: debtorAccount.replace(/^(PIX-|SPEI-|SWIFT-)/, ''),
      name: canonical.debtor.name?.substring(0, 35),
      address: canonical.debtor.address?.slice(0, 3) ?? [
        canonical.debtor.country ? `Country: ${canonical.debtor.country}` : 'Unknown',
      ],
      bic: canonical.origin.bic,
    },

    orderingInstitution: canonical.origin.bic
      ? { bic: canonical.origin.bic }
      : undefined,

    accountWithInstitution: canonical.destination.bic
      ? { bic: canonical.destination.bic }
      : undefined,

    beneficiaryCustomer: {
      account: isIban ? undefined : creditorAccount.replace(/^(PIX-|SPEI-|SWIFT-)/, ''),
      iban: isIban ? creditorAccount : undefined,
      name: canonical.creditor.name?.substring(0, 35),
      address: canonical.creditor.address?.slice(0, 3) ?? [
        canonical.creditor.country ? `Country: ${canonical.creditor.country}` : 'Unknown',
      ],
    },

    remittanceInfo: buildRemittanceInfo(canonical),
    detailsOfCharges: 'SHA',
    senderToReceiverInfo: `/MIPIT/${canonical.payment_id}`,
  };

  log.debug('Canonical → SWIFT MT103 translation complete');
  return msg;
}

/**
 * Serializes a structured MT103 message to the raw SWIFT FIN text format.
 * Output follows the standard MT103 block structure: {1:...}{2:...}{4:...-}
 */
export function serializeMt103(msg: SwiftMt103Message): string {
  const dateYYMMDD = msg.valueDate.replace(/-/g, '').slice(2); // YYMMDD
  const amountStr = msg.amount.toFixed(2).replace('.', ','); // SWIFT uses comma as decimal

  const field32A = `:32A:${dateYYMMDD}${msg.currency}${amountStr}`;

  // :50K: or :50A:
  let field50 = ':50K:';
  if (msg.orderingCustomer.account) field50 += `/${msg.orderingCustomer.account}\n`;
  if (msg.orderingCustomer.name) field50 += `${msg.orderingCustomer.name.substring(0, 35)}\n`;
  if (msg.orderingCustomer.address) {
    msg.orderingCustomer.address.slice(0, 3).forEach(line => {
      field50 += `${line.substring(0, 35)}\n`;
    });
  }

  // :57A:
  const field57 = msg.accountWithInstitution?.bic
    ? `:57A:${msg.accountWithInstitution.bic}`
    : '';

  // :59: or :59A:
  let field59 = '';
  if (msg.beneficiaryCustomer.iban) {
    field59 = `:59A:/${msg.beneficiaryCustomer.iban}\n${(msg.beneficiaryCustomer.name ?? '').substring(0, 35)}`;
  } else {
    field59 = ':59:';
    if (msg.beneficiaryCustomer.account) field59 += `/${msg.beneficiaryCustomer.account}\n`;
    if (msg.beneficiaryCustomer.name) field59 += `${msg.beneficiaryCustomer.name.substring(0, 35)}\n`;
    if (msg.beneficiaryCustomer.address) {
      msg.beneficiaryCustomer.address.slice(0, 2).forEach(line => {
        field59 += `${line.substring(0, 35)}\n`;
      });
    }
  }

  // :70:
  const field70 = msg.remittanceInfo
    ? `:70:${splitRemittance(msg.remittanceInfo)}`
    : '';

  const field71A = msg.detailsOfCharges ? `:71A:${msg.detailsOfCharges}` : ':71A:SHA';
  const field72 = msg.senderToReceiverInfo ? `:72:${msg.senderToReceiverInfo.substring(0, 35)}` : '';

  const body = [
    `:20:${msg.transactionRef.substring(0, 16)}`,
    `:23B:${msg.bankOperationCode}`,
    field32A,
    field50.trim(),
    field57,
    field59.trim(),
    field70,
    field71A,
    field72,
  ].filter(Boolean).join('\n');

  return `{1:F01MIPITSIMMXXX0000000000}{2:I103MIPITSIMMXXXN}{4:\n${body}\n-}`;
}

function buildRemittanceInfo(canonical: CanonicalPacs008): string {
  const parts: string[] = [];
  if (canonical.reference && canonical.reference !== 'MIPIT-POC') {
    parts.push(`/REF/${canonical.reference.substring(0, 16)}`);
  }
  if (canonical.remittanceInfo) {
    parts.push(canonical.remittanceInfo.substring(0, 105));
  } else if (canonical.purpose) {
    parts.push(canonical.purpose.substring(0, 35));
  }
  return parts.join(' ').substring(0, 140);
}

/** Splits remittance info into 4×35 char lines */
function splitRemittance(info: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < 140 && i < info.length; i += 35) {
    chunks.push(info.slice(i, i + 35));
  }
  return chunks.join('\n');
}
