import { swiftMt103ToCanonical, parseMt103 } from '../../../src/translation/swift-mt103-to-canonical';
import { canonicalToSwiftMt103, serializeMt103 } from '../../../src/translation/canonical-to-swift-mt103';

// Mock logger
jest.mock('../../../src/observability/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) },
}));

const SAMPLE_RAW_MT103 = `{1:F01BBDEBDBBXXX0000000000}{2:I103BANKMXMMXXXXN}{4:
:20:TXN202306010001
:23B:CRED
:32A:230601USD1500,00
:50K:/123456789
John Smith
100 Main St
New York US
:57A:BANKMXMMXXX
:59:/SPEI-012345678901234567
Maria Garcia
Mexico City MX
:70:/INV/2023-001 Payment services
:71A:SHA
-}`;

const SAMPLE_STRUCTURED_MT103 = {
  transactionRef: 'TXN202306010001',
  bankOperationCode: 'CRED' as const,
  valueDate: '2023-06-01',
  currency: 'USD',
  amount: 1500.00,
  orderingCustomer: {
    account: '123456789',
    name: 'John Smith',
    address: ['100 Main St', 'New York US'],
  },
  accountWithInstitution: { bic: 'BANKMXMMXXX' },
  beneficiaryCustomer: {
    account: 'SPEI-012345678901234567',
    name: 'Maria Garcia',
    address: ['Mexico City MX'],
  },
  remittanceInfo: '/INV/2023-001 Payment services',
  detailsOfCharges: 'SHA' as const,
};

describe('SWIFT MT103 Parser', () => {
  it('should parse raw MT103 FIN message text', () => {
    const parsed = parseMt103(SAMPLE_RAW_MT103);
    expect(parsed.transactionRef).toBe('TXN202306010001');
    expect(parsed.bankOperationCode).toBe('CRED');
    expect(parsed.currency).toBe('USD');
    expect(parsed.amount).toBe(1500);
    expect(parsed.detailsOfCharges).toBe('SHA');
  });

  it('should extract ordering customer from :50K: field', () => {
    const parsed = parseMt103(SAMPLE_RAW_MT103);
    expect(parsed.orderingCustomer.account).toBe('123456789');
    expect(parsed.orderingCustomer.name).toContain('John Smith');
  });

  it('should extract account with institution BIC from :57A:', () => {
    const parsed = parseMt103(SAMPLE_RAW_MT103);
    expect(parsed.accountWithInstitution?.bic).toBe('BANKMXMMXXX');
  });

  it('should generate a reference if :20: is missing', () => {
    const parsed = parseMt103('{4::23B:CRED\n:32A:230601USD500,00\n:59:Account\nName\n-}');
    expect(parsed.transactionRef).toBeTruthy();
    expect(parsed.transactionRef.length).toBeGreaterThan(0);
  });

  it('should parse amount with comma as decimal separator', () => {
    const parsed = parseMt103('{4::20:REF001\n:23B:CRED\n:32A:230601USD1234,56\n-}');
    expect(parsed.amount).toBeCloseTo(1234.56, 2);
  });
});

describe('swiftMt103ToCanonical', () => {
  it('should translate structured MT103 to canonical', async () => {
    const canonical = await swiftMt103ToCanonical(SAMPLE_STRUCTURED_MT103, 'PMT-AAAA0001234567890123', 'trace-001');

    expect(canonical.payment_id).toBe('PMT-AAAA0001234567890123');
    expect(canonical.amount.value).toBe(1500);
    expect(canonical.amount.currency).toBe('USD');
    expect(canonical.debtor.name).toBe('John Smith');
    expect(canonical.debtor.account_id).toBe('123456789');
    expect(canonical.creditor.name).toBe('Maria Garcia');
    expect(canonical.origin.rail).toBe('SWIFT_MT103');
    expect(canonical.trace_id).toBe('trace-001');
  });

  it('should translate raw MT103 string to canonical', async () => {
    const canonical = await swiftMt103ToCanonical(SAMPLE_RAW_MT103, 'PMT-BBBB0001234567890123');
    expect(canonical.amount.value).toBe(1500);
    expect(canonical.amount.currency).toBe('USD');
    expect(canonical.origin.rail).toBe('SWIFT_MT103');
  });

  it('should set alias type to IBAN when account starts with 2 letters + digits', async () => {
    const msg = {
      ...SAMPLE_STRUCTURED_MT103,
      beneficiaryCustomer: {
        iban: 'DE89370400440532013000',
        name: 'Klaus Müller',
      },
    };
    const canonical = await swiftMt103ToCanonical(msg, 'PMT-CCCC0001234567890123');
    expect(canonical.alias.type).toBe('IBAN');
    expect(canonical.alias.value).toBe('DE89370400440532013000');
  });

  it('should default alias type to ACCOUNT for non-IBAN accounts', async () => {
    const canonical = await swiftMt103ToCanonical(SAMPLE_STRUCTURED_MT103, 'PMT-DDDD0001234567890123');
    expect(canonical.alias.type).toBe('ACCOUNT');
  });

  it('should propagate remittance info', async () => {
    const canonical = await swiftMt103ToCanonical(SAMPLE_STRUCTURED_MT103, 'PMT-EEEE0001234567890123');
    expect(canonical.remittanceInfo).toContain('INV/2023-001');
  });

  it('should throw TranslationError on invalid payment_id format', async () => {
    await expect(
      swiftMt103ToCanonical(SAMPLE_STRUCTURED_MT103, 'INVALID-ID'),
    ).rejects.toThrow();
  });
});

describe('canonicalToSwiftMt103', () => {
  const sampleCanonical = {
    payment_id: 'PMT-FFFF0001234567890123',
    created_at: '2023-06-01T12:00:00.000Z',
    grpHdr: { msgId: 'MSG-001', creDtTm: '2023-06-01T12:00:00.000Z', nbOfTxs: 1 },
    pmtId: { endToEndId: 'E2E-0001' },
    amount: { value: 1500, currency: 'USD' },
    origin: { rail: 'SWIFT_MT103' as const, bic: 'BBDEBDBBXXX' },
    destination: { bic: 'BANKMXMMXXX' },
    debtor: { name: 'John Smith', country: 'US', account_id: '123456789' },
    creditor: { name: 'Maria Garcia', country: 'MX', account_id: 'SPEI-012345678901234567' },
    alias: { type: 'ACCOUNT' as const, value: 'SPEI-012345678901234567' },
    purpose: 'P2P',
    reference: 'MIPIT-POC',
    status: 'RECEIVED',
  };

  it('should produce a valid MT103 structured message', async () => {
    const mt103 = await canonicalToSwiftMt103(sampleCanonical as Parameters<typeof canonicalToSwiftMt103>[0]);
    expect(mt103.bankOperationCode).toBe('CRED');
    expect(mt103.currency).toBe('USD');
    expect(mt103.amount).toBe(1500);
    expect(mt103.detailsOfCharges).toBe('SHA');
    expect(mt103.orderingCustomer.name).toBe('John Smith');
    expect(mt103.beneficiaryCustomer.name).toBe('Maria Garcia');
  });

  it('should include creditor BIC from destination', async () => {
    const mt103 = await canonicalToSwiftMt103(sampleCanonical as Parameters<typeof canonicalToSwiftMt103>[0]);
    expect(mt103.accountWithInstitution?.bic).toBe('BANKMXMMXXX');
  });

  it('should serialize to valid MT103 FIN text format', async () => {
    const mt103 = await canonicalToSwiftMt103(sampleCanonical as Parameters<typeof canonicalToSwiftMt103>[0]);
    const text = serializeMt103(mt103);
    expect(text).toContain('{1:');
    expect(text).toContain('{4:');
    expect(text).toContain(':20:');
    expect(text).toContain(':32A:');
    expect(text).toContain(':71A:SHA');
    expect(text).toContain('-}');
  });

  it('should include IBAN in :59A: when account is IBAN format', async () => {
    const canonical = {
      ...sampleCanonical,
      creditor: { ...sampleCanonical.creditor, account_id: 'DE89370400440532013000' },
      alias: { type: 'IBAN' as const, value: 'DE89370400440532013000' },
    };
    const mt103 = await canonicalToSwiftMt103(canonical as Parameters<typeof canonicalToSwiftMt103>[0]);
    expect(mt103.beneficiaryCustomer.iban).toBe('DE89370400440532013000');
  });
});
