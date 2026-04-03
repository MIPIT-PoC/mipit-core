import { iso20022MxToCanonical } from '../../../src/translation/iso20022-mx-to-canonical';
import { canonicalToIso20022Mx } from '../../../src/translation/canonical-to-iso20022-mx';

jest.mock('../../../src/observability/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) },
}));

const SAMPLE_PACS008: import('../../../src/translation/iso20022-mx-to-canonical').Iso20022Pacs008 = {
  GrpHdr: {
    MsgId: 'MSG-20230601-001',
    CreDtTm: '2023-06-01T12:00:00.000Z',
    NbOfTxs: '1',
    SttlmInf: { SttlmMtd: 'CLRG' },
    InstgAgt: { FinInstnId: { BICFI: 'BBDEBDBBXXX' } },
    InstdAgt: { FinInstnId: { BICFI: 'BANKMXMMXXX' } },
  },
  CdtTrfTxInf: {
    PmtId: {
      InstrId: 'INSTR-001',
      EndToEndId: 'E2E-20230601-001',
      TxId: 'TXN-001',
    },
    IntrBkSttlmAmt: { Ccy: 'EUR', value: '2500.00' },
    InstdAmt: { Ccy: 'USD', value: '2750.00' },
    IntrBkSttlmDt: '2023-06-01',
    XchgRate: '1.1',
    DbtrAgt: { FinInstnId: { BICFI: 'BBDEBDBBXXX' } },
    Dbtr: {
      Nm: 'Hans Müller',
      PstlAdr: { Ctry: 'DE', AdrLine: ['Berliner Str. 1', 'Berlin'] },
    },
    DbtrAcct: { Id: { IBAN: 'DE89370400440532013000' } },
    CdtrAgt: { FinInstnId: { BICFI: 'BANKMXMMXXX' } },
    Cdtr: {
      Nm: 'Maria Garcia',
      PstlAdr: { Ctry: 'MX', AdrLine: ['Reforma 222', 'CDMX'] },
    },
    CdtrAcct: { Id: { Othr: { Id: '032180000118359719', SchmeNm: { Cd: 'BBAN' } } } },
    Purp: { Cd: 'SUPP' },
    RmtInf: { Ustrd: 'Invoice INV-2023-001 payment' },
  },
};

describe('iso20022MxToCanonical', () => {
  it('should translate pacs.008 to canonical format', async () => {
    const canonical = await iso20022MxToCanonical(SAMPLE_PACS008, 'PMT-AAAA0001234567890123', 'trace-001');

    expect(canonical.payment_id).toBe('PMT-AAAA0001234567890123');
    expect(canonical.amount.value).toBe(2500);
    expect(canonical.amount.currency).toBe('EUR');
    expect(canonical.origin.rail).toBe('ISO20022_MX');
    expect(canonical.trace_id).toBe('trace-001');
  });

  it('should extract debtor IBAN as account_id', async () => {
    const canonical = await iso20022MxToCanonical(SAMPLE_PACS008, 'PMT-BBBB0001234567890123');
    expect(canonical.debtor.account_id).toBe('DE89370400440532013000');
    expect(canonical.debtor.name).toBe('Hans Müller');
    expect(canonical.debtor.country).toBe('DE');
  });

  it('should extract creditor Othr account when no IBAN', async () => {
    const canonical = await iso20022MxToCanonical(SAMPLE_PACS008, 'PMT-CCCC0001234567890123');
    expect(canonical.creditor.account_id).toBe('032180000118359719');
    expect(canonical.creditor.name).toBe('Maria Garcia');
  });

  it('should set alias type to IBAN when debtor has IBAN creditor Othr', async () => {
    const canonical = await iso20022MxToCanonical(SAMPLE_PACS008, 'PMT-DDDD0001234567890123');
    // Creditor has Othr, not IBAN → ACCOUNT
    expect(canonical.alias.type).toBe('ACCOUNT');
  });

  it('should set alias type to IBAN when creditor has IBAN', async () => {
    const ibanMsg = {
      ...SAMPLE_PACS008,
      CdtTrfTxInf: {
        ...SAMPLE_PACS008.CdtTrfTxInf,
        CdtrAcct: { Id: { IBAN: 'DE89370400440532013000' } },
      },
    };
    const canonical = await iso20022MxToCanonical(ibanMsg, 'PMT-EEEE0001234567890123');
    expect(canonical.alias.type).toBe('IBAN');
    expect(canonical.alias.value).toBe('DE89370400440532013000');
  });

  it('should extract FX information', async () => {
    const canonical = await iso20022MxToCanonical(SAMPLE_PACS008, 'PMT-FFFF0001234567890123');
    expect(canonical.fx).toBeDefined();
    expect(canonical.fx?.rate).toBe(1.1);
    expect(canonical.fx?.source_currency).toBe('USD');
  });

  it('should extract remittance info', async () => {
    const canonical = await iso20022MxToCanonical(SAMPLE_PACS008, 'PMT-GGGG0001234567890123');
    expect(canonical.remittanceInfo).toContain('Invoice INV-2023-001');
  });

  it('should extract BIC for origin and destination', async () => {
    const canonical = await iso20022MxToCanonical(SAMPLE_PACS008, 'PMT-HHHH0001234567890123');
    expect(canonical.origin.bic).toBe('BBDEBDBBXXX');
    expect(canonical.destination.bic).toBe('BANKMXMMXXX');
  });

  it('should handle wrapped Document format', async () => {
    const wrapped = {
      Document: {
        FIToFICstmrCdtTrf: SAMPLE_PACS008,
      },
    };
    const canonical = await iso20022MxToCanonical(wrapped, 'PMT-IIII0001234567890123');
    expect(canonical.amount.value).toBe(2500);
    expect(canonical.origin.rail).toBe('ISO20022_MX');
  });

  it('should extract structured remittance ref', async () => {
    const msgWithStrdRmt = {
      ...SAMPLE_PACS008,
      CdtTrfTxInf: {
        ...SAMPLE_PACS008.CdtTrfTxInf,
        RmtInf: {
          Strd: [{ CdtrRefInf: { Ref: 'REF-STRUCTURED-001' } }],
        },
      },
    };
    const canonical = await iso20022MxToCanonical(msgWithStrdRmt, 'PMT-JJJJ0001234567890123');
    expect(canonical.remittanceInfo).toBe('REF-STRUCTURED-001');
  });

  it('should throw on invalid paymentId format', async () => {
    await expect(iso20022MxToCanonical(SAMPLE_PACS008, 'INVALID')).rejects.toThrow();
  });
});

describe('canonicalToIso20022Mx', () => {
  const sampleCanonical = {
    payment_id: 'PMT-KKKK0001234567890123',
    created_at: '2023-06-01T12:00:00.000Z',
    grpHdr: { msgId: 'MSG-001', creDtTm: '2023-06-01T12:00:00.000Z', nbOfTxs: 1 },
    pmtId: { endToEndId: 'E2E-0001' },
    amount: { value: 2500, currency: 'EUR' },
    origin: { rail: 'ISO20022_MX' as const, bic: 'BBDEBDBBXXX' },
    destination: { bic: 'BANKMXMMXXX' },
    debtor: { name: 'Hans Müller', country: 'DE', account_id: 'DE89370400440532013000' },
    creditor: { name: 'Maria Garcia', country: 'MX', account_id: '032180000118359719' },
    alias: { type: 'ACCOUNT' as const, value: '032180000118359719' },
    purpose: 'SUPP',
    reference: 'MIPIT-POC',
    status: 'RECEIVED',
    remittanceInfo: 'Invoice INV-2023-001',
  };

  it('should produce valid ISO 20022 pacs.008 structure', async () => {
    const result = await canonicalToIso20022Mx(sampleCanonical as Parameters<typeof canonicalToIso20022Mx>[0]);
    expect(result.GrpHdr.MsgId).toBeDefined();
    expect(result.GrpHdr.NbOfTxs).toBe('1');
    expect(result.CdtTrfTxInf.IntrBkSttlmAmt.Ccy).toBe('EUR');
    expect(parseFloat(result.CdtTrfTxInf.IntrBkSttlmAmt.value)).toBe(2500);
  });

  it('should map debtor and creditor correctly', async () => {
    const result = await canonicalToIso20022Mx(sampleCanonical as Parameters<typeof canonicalToIso20022Mx>[0]);
    expect(result.CdtTrfTxInf.Dbtr.Nm).toBe('Hans Müller');
    expect(result.CdtTrfTxInf.Cdtr.Nm).toBe('Maria Garcia');
  });

  it('should set IBAN in DbtrAcct when debtor account is IBAN format', async () => {
    const result = await canonicalToIso20022Mx(sampleCanonical as Parameters<typeof canonicalToIso20022Mx>[0]);
    // DE89370400440532013000 starts with 2 letters → IBAN
    expect(result.CdtTrfTxInf.DbtrAcct.Id.IBAN).toBe('DE89370400440532013000');
  });

  it('should set Othr in CdtrAcct when creditor account is not IBAN', async () => {
    const result = await canonicalToIso20022Mx(sampleCanonical as Parameters<typeof canonicalToIso20022Mx>[0]);
    expect(result.CdtTrfTxInf.CdtrAcct.Id.Othr?.Id).toBe('032180000118359719');
  });

  it('should include BICs in agent elements', async () => {
    const result = await canonicalToIso20022Mx(sampleCanonical as Parameters<typeof canonicalToIso20022Mx>[0]);
    expect(result.CdtTrfTxInf.DbtrAgt?.FinInstnId.BICFI).toBe('BBDEBDBBXXX');
    expect(result.CdtTrfTxInf.CdtrAgt?.FinInstnId.BICFI).toBe('BANKMXMMXXX');
  });

  it('should include remittance info', async () => {
    const result = await canonicalToIso20022Mx(sampleCanonical as Parameters<typeof canonicalToIso20022Mx>[0]);
    expect(result.CdtTrfTxInf.RmtInf?.Ustrd).toContain('INV-2023-001');
  });

  it('should have correct settlement method', async () => {
    const result = await canonicalToIso20022Mx(sampleCanonical as Parameters<typeof canonicalToIso20022Mx>[0]);
    expect(result.GrpHdr.SttlmInf.SttlmMtd).toBe('CLRG');
  });
});
