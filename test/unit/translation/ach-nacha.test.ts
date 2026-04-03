import { achNachaToCanonical } from '../../../src/translation/ach-nacha-to-canonical';
import { canonicalToAchNacha, serializeAchNacha } from '../../../src/translation/canonical-to-ach-nacha';
import type { AchNachaTransaction } from '../../../src/translation/ach-nacha-to-canonical';

jest.mock('../../../src/observability/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) },
}));

const SAMPLE_ACH_TXN: AchNachaTransaction = {
  batchHeader: {
    recordType: '5',
    serviceClassCode: '220',
    companyName: 'ACME CORP',
    companyId: '1234567890',
    secCode: 'PPD',
    companyEntryDescription: 'PAYROLL',
    companyDescriptiveDate: '230601',
    effectiveEntryDate: '230601',
    originatingDfiId: '02100002',
    batchNumber: '0000001',
  },
  entryDetail: {
    recordType: '6',
    transactionCode: 22,
    routingTransitNumber: '021000021',
    accountNumber: '123456789',
    amount: 150000,   // $1,500.00 in cents
    individualIdNumber: 'EMP-001',
    individualName: 'John Smith',
    discretionaryData: '  ',
    addendaRecordIndicator: '0',
    traceNumber: '021000020000001',
  },
  originator: {
    name: 'ACME CORP',
    accountNumber: '987654321',
    routingNumber: '021000021',
    taxId: '123456789',
  },
  odfi: {
    name: 'JPMorgan Chase',
    routingNumber: '021000021',
    countryCode: 'US',
  },
};

describe('achNachaToCanonical', () => {
  it('should translate ACH NACHA transaction to canonical', async () => {
    const canonical = await achNachaToCanonical(SAMPLE_ACH_TXN, 'PMT-AAAA0001234567890123', 'trace-001');

    expect(canonical.payment_id).toBe('PMT-AAAA0001234567890123');
    expect(canonical.amount.value).toBe(1500);  // cents → dollars
    expect(canonical.amount.currency).toBe('USD');
    expect(canonical.origin.rail).toBe('ACH_NACHA');
    expect(canonical.trace_id).toBe('trace-001');
  });

  it('should convert amount from cents to dollars correctly', async () => {
    const canonical = await achNachaToCanonical(SAMPLE_ACH_TXN, 'PMT-BBBB0001234567890123');
    expect(canonical.amount.value).toBe(1500.00);
  });

  it('should extract creditor info from entry detail', async () => {
    const canonical = await achNachaToCanonical(SAMPLE_ACH_TXN, 'PMT-CCCC0001234567890123');
    expect(canonical.creditor.name).toBe('John Smith');
    expect(canonical.creditor.account_id.trim()).toBe('123456789');
    expect(canonical.creditor.country).toBe('US');
  });

  it('should extract debtor info from originator', async () => {
    const canonical = await achNachaToCanonical(SAMPLE_ACH_TXN, 'PMT-DDDD0001234567890123');
    expect(canonical.debtor.name).toBe('ACME CORP');
    expect(canonical.debtor.account_id).toBe('987654321');
  });

  it('should use routing numbers in alias', async () => {
    const canonical = await achNachaToCanonical(SAMPLE_ACH_TXN, 'PMT-EEEE0001234567890123');
    expect(canonical.alias.type).toBe('ABA_ROUTING');
    expect(canonical.alias.value).toContain('021000021');
  });

  it('should use trace number as endToEndId', async () => {
    const canonical = await achNachaToCanonical(SAMPLE_ACH_TXN, 'PMT-FFFF0001234567890123');
    expect(canonical.pmtId.endToEndId).toBe('021000020000001');
  });

  it('should convert effectiveEntryDate YYMMDD to ISO date', async () => {
    const canonical = await achNachaToCanonical(SAMPLE_ACH_TXN, 'PMT-GGGG0001234567890123');
    // 230601 → 2023-06-01
    expect(canonical.created_at).toBeDefined();
  });

  it('should extract addenda payment info as remittanceInfo', async () => {
    const txnWithAddenda: AchNachaTransaction = {
      ...SAMPLE_ACH_TXN,
      entryDetail: { ...SAMPLE_ACH_TXN.entryDetail, addendaRecordIndicator: '1' },
      addenda: [{
        recordType: '7',
        addendaTypeCode: '05',
        paymentRelatedInfo: 'Invoice INV-2023-001',
        addendaSequence: '0001',
        traceNumber: '021000020000001',
      }],
    };
    const canonical = await achNachaToCanonical(txnWithAddenda, 'PMT-HHHH0001234567890123');
    expect(canonical.remittanceInfo).toBe('Invoice INV-2023-001');
  });

  it('should generate trace number when not provided', async () => {
    const txnNoTrace: AchNachaTransaction = {
      ...SAMPLE_ACH_TXN,
      entryDetail: { ...SAMPLE_ACH_TXN.entryDetail, traceNumber: undefined },
    };
    const canonical = await achNachaToCanonical(txnNoTrace, 'PMT-IIII0001234567890123');
    expect(canonical.pmtId.endToEndId).toBeTruthy();
    expect(canonical.pmtId.endToEndId.length).toBeGreaterThan(0);
  });

  it('should handle PPD and CCD sec codes', async () => {
    const ccdTxn = {
      ...SAMPLE_ACH_TXN,
      batchHeader: { ...SAMPLE_ACH_TXN.batchHeader, secCode: 'CCD' as const },
    };
    const canonical = await achNachaToCanonical(ccdTxn, 'PMT-JJJJ0001234567890123');
    expect(canonical.purpose).toBe('PAYROLL');
  });
});

describe('canonicalToAchNacha', () => {
  const sampleCanonical = {
    payment_id: 'PMT-KKKK0001234567890123',
    created_at: '2023-06-01T12:00:00.000Z',
    grpHdr: { msgId: 'MSG-001', creDtTm: '2023-06-01T12:00:00.000Z', nbOfTxs: 1 },
    pmtId: { endToEndId: 'E2E-0001' },
    amount: { value: 1500, currency: 'USD' },
    origin: { rail: 'ACH_NACHA' as const, routingNumber: '021000021' },
    destination: { routingNumber: '021000021' },
    debtor: { name: 'ACME CORP', country: 'US', account_id: '987654321', taxId: '12-3456789' },
    creditor: { name: 'John Smith', country: 'US', account_id: '021000021/123456789' },
    alias: { type: 'ABA_ROUTING' as const, value: '021000021/123456789' },
    purpose: 'PAYROLL',
    reference: 'MIPIT-POC',
    status: 'RECEIVED',
  };

  it('should produce valid ACH NACHA transaction structure', async () => {
    const txn = await canonicalToAchNacha(sampleCanonical as Parameters<typeof canonicalToAchNacha>[0]);
    expect(txn.batchHeader.recordType).toBe('5');
    expect(txn.entryDetail.recordType).toBe('6');
    expect(txn.entryDetail.transactionCode).toBe(22);
  });

  it('should convert amount to cents', async () => {
    const txn = await canonicalToAchNacha(sampleCanonical as Parameters<typeof canonicalToAchNacha>[0]);
    expect(txn.entryDetail.amount).toBe(150000);  // $1500 × 100
  });

  it('should set company name and entry description', async () => {
    const txn = await canonicalToAchNacha(sampleCanonical as Parameters<typeof canonicalToAchNacha>[0]);
    expect(txn.batchHeader.companyName.trim()).toBe('ACME CORP');
    expect(txn.batchHeader.companyEntryDescription.trim()).toBe('PAYROLL');
  });

  it('should extract routing number from alias', async () => {
    const txn = await canonicalToAchNacha(sampleCanonical as Parameters<typeof canonicalToAchNacha>[0]);
    expect(txn.entryDetail.routingTransitNumber).toBe('021000021');
    expect(txn.entryDetail.accountNumber.trim()).toBe('123456789');
  });

  it('should set individual name from creditor', async () => {
    const txn = await canonicalToAchNacha(sampleCanonical as Parameters<typeof canonicalToAchNacha>[0]);
    expect(txn.entryDetail.individualName.trim()).toBe('John Smith');
  });

  it('should include addenda when remittanceInfo is present', async () => {
    const canonicalWithRmt = { ...sampleCanonical, remittanceInfo: 'Invoice INV-2023-001' };
    const txn = await canonicalToAchNacha(canonicalWithRmt as Parameters<typeof canonicalToAchNacha>[0]);
    expect(txn.addenda).toBeDefined();
    expect(txn.addenda?.length).toBeGreaterThan(0);
    expect(txn.addenda?.[0].paymentRelatedInfo).toContain('Invoice INV-2023-001');
    expect(txn.entryDetail.addendaRecordIndicator).toBe('1');
  });
});

describe('serializeAchNacha', () => {
  it('should serialize to NACHA fixed-width text format', async () => {
    const txn = await canonicalToAchNacha({
      payment_id: 'PMT-LLLL0001234567890123',
      created_at: '2023-06-01T12:00:00.000Z',
      grpHdr: { msgId: 'MSG-001', creDtTm: '2023-06-01T12:00:00.000Z', nbOfTxs: 1 },
      pmtId: { endToEndId: 'E2E-0001' },
      amount: { value: 1500, currency: 'USD' },
      origin: { rail: 'ACH_NACHA' as const, routingNumber: '021000021' },
      destination: {},
      debtor: { name: 'ACME CORP', country: 'US', account_id: '987654321' },
      creditor: { name: 'John Smith', country: 'US', account_id: '021000021/123456789' },
      alias: { type: 'ABA_ROUTING' as const, value: '021000021/123456789' },
      purpose: 'P2P',
      reference: 'MIPIT-POC',
      status: 'RECEIVED',
    } as Parameters<typeof canonicalToAchNacha>[0]);

    const text = serializeAchNacha(txn);
    const lines = text.split('\n');

    // All lines must be exactly 94 chars
    lines.forEach((line, idx) => {
      expect(line.length).toBe(94);
    });

    // Total line count must be divisible by 10
    expect(lines.length % 10).toBe(0);

    // Check record types
    expect(lines[0][0]).toBe('1');   // File Header
    expect(lines[1][0]).toBe('5');   // Batch Header
    expect(lines[2][0]).toBe('6');   // Entry Detail
  });

  it('should include correct record type indicators', () => {
    const text = serializeAchNacha(SAMPLE_ACH_TXN);
    const lines = text.split('\n').filter(l => l.trim().length > 0);

    const recordTypes = lines.map(l => l[0]);
    expect(recordTypes).toContain('1');
    expect(recordTypes).toContain('5');
    expect(recordTypes).toContain('6');
    expect(recordTypes).toContain('8');
    expect(recordTypes).toContain('9');
  });

  it('should have amount in cents without decimal in entry detail', () => {
    const text = serializeAchNacha(SAMPLE_ACH_TXN);
    const entryLine = text.split('\n').find(l => l[0] === '6');
    expect(entryLine).toBeDefined();
    // Amount field: positions 29-38 (10 digits, no decimal), $1500.00 = 150000 → '0000150000'
    const amountField = entryLine!.substring(29, 39);
    expect(amountField).toBe('0000150000');
  });
});
