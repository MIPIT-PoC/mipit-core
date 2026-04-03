import type { CanonicalPacs008 } from '../domain/models/canonical.js';
import { logger } from '../observability/logger.js';
import type { AchNachaTransaction } from './ach-nacha-to-canonical.js';

/**
 * Converts the canonical pacs.008 model to an ACH NACHA transaction structure.
 * Generates proper NACHA entry detail records with ABA routing numbers.
 */
export async function canonicalToAchNacha(canonical: CanonicalPacs008): Promise<AchNachaTransaction> {
  const log = logger.child({ payment_id: canonical.payment_id, destination: 'ACH_NACHA' });

  // Amount in cents (NACHA standard: no decimal in dollar amount field)
  const amountCents = Math.round(canonical.amount.value * 100);

  // Effective date in YYMMDD
  const isoDate = canonical.created_at.slice(0, 10);
  const yymmdd = `${isoDate.slice(2, 4)}${isoDate.slice(5, 7)}${isoDate.slice(8, 10)}`;

  // Extract ABA routing number from alias value (format: "routingNumber/accountNumber")
  const [cdtrRouting, cdtrAccount] = parseAbaAlias(canonical.alias.value, canonical.creditor.account_id);
  const [dbtrRouting, dbtrAccount] = parseAbaAlias(
    `${canonical.origin.routingNumber ?? '000000000'}/${canonical.debtor.account_id.replace(/^SPEI-|^PIX-/, '')}`,
    canonical.debtor.account_id,
  );

  // ODFI routing (originating institution)
  const odfiRouting = canonical.origin.routingNumber ?? dbtrRouting ?? '000000000';

  // Batch number from payment_id
  const batchNum = canonical.payment_id.replace('PMT-', '').substring(0, 7).replace(/[^0-9]/g, '0');

  // Trace number
  const traceNum = `${odfiRouting.substring(0, 8)}${Math.floor(Date.now() % 10000000).toString().padStart(7, '0')}`;

  const txn: AchNachaTransaction = {
    batchHeader: {
      recordType: '5',
      serviceClassCode: '220',  // Credits only
      companyName: (canonical.debtor.name ?? 'MIPIT').substring(0, 16).padEnd(16),
      companyId: canonical.debtor.taxId?.replace(/\D/g, '').substring(0, 10) ?? '1234567890',
      secCode: canonical.destination.routingNumber ? 'CCD' : 'PPD',
      companyEntryDescription: (canonical.purpose ?? 'P2P').substring(0, 10).padEnd(10),
      companyDescriptiveDate: yymmdd,
      effectiveEntryDate: yymmdd,
      originatingDfiId: odfiRouting.substring(0, 8),
      batchNumber: batchNum.padStart(7, '0'),
    },

    entryDetail: {
      recordType: '6',
      transactionCode: 22,  // Checking account credit
      routingTransitNumber: cdtrRouting.substring(0, 9),
      accountNumber: cdtrAccount.substring(0, 17).padEnd(17),
      amount: amountCents,
      individualIdNumber: canonical.creditor.taxId?.substring(0, 15),
      individualName: (canonical.creditor.name ?? 'BENEFICIARY').substring(0, 22).padEnd(22),
      discretionaryData: '  ',
      addendaRecordIndicator: canonical.remittanceInfo ? '1' : '0',
      traceNumber: traceNum,
    },

    originator: {
      name: canonical.debtor.name ?? 'MIPIT',
      accountNumber: dbtrAccount,
      routingNumber: dbtrRouting,
      taxId: canonical.debtor.taxId,
    },

    odfi: {
      name: 'MIPIT FI',
      routingNumber: odfiRouting,
      countryCode: 'US',
    },

    addenda: canonical.remittanceInfo
      ? [
          {
            recordType: '7',
            addendaTypeCode: '05',
            paymentRelatedInfo: buildAddendaPaymentInfo(canonical),
            addendaSequence: '0001',
            traceNumber: traceNum,
          },
        ]
      : undefined,
  };

  log.debug('Canonical → ACH NACHA translation complete');
  return txn;
}

/**
 * Serializes an ACH NACHA transaction to the standard NACHA fixed-width text format.
 * Each record is exactly 94 characters.
 */
export function serializeAchNacha(txn: AchNachaTransaction): string {
  const lines: string[] = [];

  // File Header (Type 1)
  const today = new Date();
  const fileDate = `${today.getFullYear().toString().slice(2)}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const fileTime = `${String(today.getHours()).padStart(2, '0')}${String(today.getMinutes()).padStart(2, '0')}`;
  lines.push(`101 ${txn.odfi.routingNumber.substring(0, 9)} ${'0'.repeat(9).substring(0, 10)}${fileDate}${fileTime}A094101${('MIPIT FI').padEnd(23).substring(0, 23)}${'MIPIT PoC ACH   '.substring(0, 23).padEnd(23)}        1`.substring(0, 94));

  // Batch Header (Type 5)
  const bh = txn.batchHeader;
  lines.push(
    `5${bh.serviceClassCode}${bh.companyName.padEnd(16).substring(0, 16)}${' '.repeat(20)}${bh.companyId.padEnd(10).substring(0, 10)}${bh.secCode}${bh.companyEntryDescription.padEnd(10).substring(0, 10)}${bh.companyDescriptiveDate?.padEnd(6).substring(0, 6) ?? '      '}${bh.effectiveEntryDate}   1${bh.originatingDfiId.substring(0, 8)}${bh.batchNumber.padStart(7, '0')}`.substring(0, 94),
  );

  // Entry Detail (Type 6)
  const ed = txn.entryDetail;
  const amountStr = ed.amount.toString().padStart(10, '0');
  lines.push(
    `6${ed.transactionCode}${ed.routingTransitNumber.substring(0, 9)}${ed.accountNumber.padEnd(17).substring(0, 17)}${amountStr}${(ed.individualIdNumber ?? '').padEnd(15).substring(0, 15)}${ed.individualName.padEnd(22).substring(0, 22)}${ed.discretionaryData ?? '  '}${ed.addendaRecordIndicator}${(ed.traceNumber ?? '0'.repeat(15)).substring(0, 15)}`.substring(0, 94),
  );

  // Addenda Records (Type 7)
  if (txn.addenda) {
    for (const add of txn.addenda) {
      lines.push(
        `7${add.addendaTypeCode}${add.paymentRelatedInfo.padEnd(80).substring(0, 80)}${add.addendaSequence.padStart(4, '0')}${add.traceNumber.substring(0, 7)}`.substring(0, 94),
      );
    }
  }

  // Batch Control (Type 8)
  const entryCount = 1 + (txn.addenda?.length ?? 0);
  const hash = ed.routingTransitNumber.substring(0, 8).padStart(10, '0');
  lines.push(
    `8${bh.serviceClassCode}${String(entryCount).padStart(6, '0')}${hash}${ed.amount.toString().padStart(12, '0')}${'0'.repeat(12)}${' '.repeat(39)}${bh.originatingDfiId.substring(0, 8)}${bh.batchNumber.padStart(7, '0')}`.substring(0, 94),
  );

  // File Control (Type 9)
  const blockCount = Math.ceil((lines.length + 2) / 10);
  lines.push(
    `9000001${String(blockCount).padStart(6, '0')}${String(entryCount).padStart(8, '0')}${hash}${ed.amount.toString().padStart(12, '0')}${'0'.repeat(12)}${' '.repeat(39)}`.substring(0, 94),
  );

  // Pad to block of 10 (NACHA files must have line counts divisible by 10)
  while (lines.length % 10 !== 0) {
    lines.push('9'.repeat(94));
  }

  return lines.join('\n');
}

/** Parses "routingNumber/accountNumber" or returns defaults */
function parseAbaAlias(aliasValue: string, fallbackAccount: string): [string, string] {
  const parts = aliasValue.split('/');
  if (parts.length >= 2 && /^\d{9}$/.test(parts[0])) {
    return [parts[0], parts.slice(1).join('/').replace(/^(PIX-|SPEI-)/, '')];
  }
  return ['021000021', fallbackAccount.replace(/^(PIX-|SPEI-)/, '')]; // Default: JPMorgan Chase
}

/** Builds addenda payment related info */
function buildAddendaPaymentInfo(canonical: CanonicalPacs008): string {
  const parts: string[] = [];
  if (canonical.remittanceInfo) parts.push(canonical.remittanceInfo);
  if (canonical.reference && canonical.reference !== 'MIPIT-POC') parts.push(`REF:${canonical.reference}`);
  return parts.join(' ').substring(0, 80);
}
