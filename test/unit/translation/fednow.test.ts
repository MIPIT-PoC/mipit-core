import { fednowToCanonical } from '../../../src/translation/fednow-to-canonical';
import { canonicalToFednow } from '../../../src/translation/canonical-to-fednow';
import type { FedNowPaymentMessage } from '../../../src/translation/fednow-to-canonical';

jest.mock('../../../src/observability/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) },
}));

const SAMPLE_FEDNOW: FedNowPaymentMessage = {
  BusinessMessageHeader: {
    Fr: { FIId: { FinInstnId: { ClrSysMmbId: { MmbId: '021000021' } } } },
    To: { FIId: { FinInstnId: { ClrSysMmbId: { MmbId: '026009593' } } } },
    BizMsgIdr: 'BIZID-20230601-001',
    MsgDefIdr: 'pacs.008.001.08',
    BizSvc: 'fednow',
    CreDt: '2023-06-01T12:00:00.000Z',
  },
  FIToFICstmrCdtTrf: {
    GrpHdr: {
      MsgId: 'MSG-20230601-001',
      CreDtTm: '2023-06-01T12:00:00.000Z',
      NbOfTxs: '1',
      SttlmInf: {
        SttlmMtd: 'CLRG',
        ClrSys: { Cd: 'USABA' },
      },
    },
    CdtTrfTxInf: {
      PmtId: {
        EndToEndId: 'E2E-20230601-001',
        TxId: 'FED-TXN-001',
        UETR: 'a5d5c3b2-1e4f-4a8b-9c0d-1234567890ab',
      },
      IntrBkSttlmAmt: { Ccy: 'USD', value: '1500.00' },
      IntrBkSttlmDt: '2023-06-01',
      DbtrAgt: {
        FinInstnId: {
          ClrSysMmbId: {
            ClrSysId: { Cd: 'USABA' },
            MmbId: '021000021',
          },
        },
      },
      Dbtr: {
        Nm: 'Alice Johnson',
        PstlAdr: { Ctry: 'US', AdrLine: ['123 Main St', 'New York NY 10001'] },
      },
      DbtrAcct: {
        Id: { Othr: { Id: '987654321', SchmeNm: { Cd: 'BBAN' } } },
        Tp: { Cd: 'CACC' },
      },
      CdtrAgt: {
        FinInstnId: {
          ClrSysMmbId: {
            ClrSysId: { Cd: 'USABA' },
            MmbId: '026009593',
          },
        },
      },
      Cdtr: {
        Nm: 'Bob Martinez',
        PstlAdr: { Ctry: 'US', AdrLine: ['456 Oak Ave', 'Los Angeles CA 90001'] },
      },
      CdtrAcct: {
        Id: { Othr: { Id: '123456789', SchmeNm: { Cd: 'BBAN' } } },
        Tp: { Cd: 'CACC' },
      },
      Purp: { Cd: 'SALA' },
      RmtInf: { Ustrd: 'June 2023 salary payment' },
      LclInstrm: { Prtry: 'INST' },
    },
  },
};

describe('fednowToCanonical', () => {
  it('should translate FedNow message to canonical format', async () => {
    const canonical = await fednowToCanonical(SAMPLE_FEDNOW, 'PMT-AAAA0001234567890123', 'trace-001');

    expect(canonical.payment_id).toBe('PMT-AAAA0001234567890123');
    expect(canonical.amount.value).toBe(1500);
    expect(canonical.amount.currency).toBe('USD');
    expect(canonical.origin.rail).toBe('FEDNOW');
    expect(canonical.trace_id).toBe('trace-001');
  });

  it('should extract ABA routing numbers', async () => {
    const canonical = await fednowToCanonical(SAMPLE_FEDNOW, 'PMT-BBBB0001234567890123');
    expect(canonical.origin.routingNumber).toBe('021000021');
    expect(canonical.destination.routingNumber).toBe('026009593');
  });

  it('should combine routing number and account in account_id', async () => {
    const canonical = await fednowToCanonical(SAMPLE_FEDNOW, 'PMT-CCCC0001234567890123');
    expect(canonical.debtor.account_id).toBe('021000021/987654321');
    expect(canonical.creditor.account_id).toBe('026009593/123456789');
  });

  it('should extract names correctly', async () => {
    const canonical = await fednowToCanonical(SAMPLE_FEDNOW, 'PMT-DDDD0001234567890123');
    expect(canonical.debtor.name).toBe('Alice Johnson');
    expect(canonical.creditor.name).toBe('Bob Martinez');
  });

  it('should always use USD currency', async () => {
    const canonical = await fednowToCanonical(SAMPLE_FEDNOW, 'PMT-EEEE0001234567890123');
    expect(canonical.amount.currency).toBe('USD');
  });

  it('should set alias type to ABA_ROUTING', async () => {
    const canonical = await fednowToCanonical(SAMPLE_FEDNOW, 'PMT-FFFF0001234567890123');
    expect(canonical.alias.type).toBe('ABA_ROUTING');
    expect(canonical.alias.value).toBe('026009593/123456789');
  });

  it('should use UETR as trace_id when no traceId provided', async () => {
    const canonical = await fednowToCanonical(SAMPLE_FEDNOW, 'PMT-GGGG0001234567890123');
    expect(canonical.trace_id).toBe('a5d5c3b2-1e4f-4a8b-9c0d-1234567890ab');
  });

  it('should extract remittance info', async () => {
    const canonical = await fednowToCanonical(SAMPLE_FEDNOW, 'PMT-HHHH0001234567890123');
    expect(canonical.remittanceInfo).toBe('June 2023 salary payment');
  });

  it('should extract purpose code', async () => {
    const canonical = await fednowToCanonical(SAMPLE_FEDNOW, 'PMT-IIII0001234567890123');
    expect(canonical.purpose).toBe('SALA');
  });

  it('should use settlement method CLRG', async () => {
    const canonical = await fednowToCanonical(SAMPLE_FEDNOW, 'PMT-JJJJ0001234567890123');
    expect(canonical.grpHdr.sttlmInf?.sttlmMtd).toBe('CLRG');
  });

  it('should default country to US when not specified', async () => {
    const msgNoCountry = {
      ...SAMPLE_FEDNOW,
      FIToFICstmrCdtTrf: {
        ...SAMPLE_FEDNOW.FIToFICstmrCdtTrf,
        CdtTrfTxInf: {
          ...SAMPLE_FEDNOW.FIToFICstmrCdtTrf.CdtTrfTxInf,
          Dbtr: { Nm: 'Alice Johnson' },
          Cdtr: { Nm: 'Bob Martinez' },
        },
      },
    };
    const canonical = await fednowToCanonical(msgNoCountry, 'PMT-KKKK0001234567890123');
    expect(canonical.debtor.country).toBe('US');
    expect(canonical.creditor.country).toBe('US');
  });

  it('should throw TranslationError on invalid payment_id', async () => {
    await expect(fednowToCanonical(SAMPLE_FEDNOW, 'BAD-ID')).rejects.toThrow();
  });
});

describe('canonicalToFednow', () => {
  const sampleCanonical = {
    payment_id: 'PMT-LLLL0001234567890123',
    created_at: '2023-06-01T12:00:00.000Z',
    grpHdr: {
      msgId: 'MSG-001',
      creDtTm: '2023-06-01T12:00:00.000Z',
      nbOfTxs: 1,
      sttlmInf: { sttlmMtd: 'CLRG' as const },
    },
    pmtId: { endToEndId: 'E2E-0001' },
    amount: { value: 1500, currency: 'USD' },
    origin: { rail: 'FEDNOW' as const, routingNumber: '021000021' },
    destination: { routingNumber: '026009593' },
    debtor: { name: 'Alice Johnson', country: 'US', account_id: '021000021/987654321' },
    creditor: { name: 'Bob Martinez', country: 'US', account_id: '026009593/123456789' },
    alias: { type: 'ABA_ROUTING' as const, value: '026009593/123456789' },
    purpose: 'P2P',
    reference: 'MIPIT-POC',
    status: 'RECEIVED',
  };

  it('should produce valid FedNow message structure', async () => {
    const result = await canonicalToFednow(sampleCanonical as Parameters<typeof canonicalToFednow>[0]);
    expect(result.FIToFICstmrCdtTrf).toBeDefined();
    expect(result.FIToFICstmrCdtTrf.GrpHdr.NbOfTxs).toBe('1');
    expect(result.FIToFICstmrCdtTrf.GrpHdr.SttlmInf.SttlmMtd).toBe('CLRG');
  });

  it('should always set currency to USD', async () => {
    const result = await canonicalToFednow(sampleCanonical as Parameters<typeof canonicalToFednow>[0]);
    expect(result.FIToFICstmrCdtTrf.CdtTrfTxInf.IntrBkSttlmAmt.Ccy).toBe('USD');
  });

  it('should include UETR (UUID v4 format)', async () => {
    const result = await canonicalToFednow(sampleCanonical as Parameters<typeof canonicalToFednow>[0]);
    const uetr = result.FIToFICstmrCdtTrf.CdtTrfTxInf.PmtId.UETR;
    expect(uetr).toBeDefined();
    // UUID v4 pattern: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(uetr).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('should extract routing numbers from alias', async () => {
    const result = await canonicalToFednow(sampleCanonical as Parameters<typeof canonicalToFednow>[0]);
    expect(result.FIToFICstmrCdtTrf.CdtTrfTxInf.CdtrAgt.FinInstnId.ClrSysMmbId.MmbId).toBe('026009593');
  });

  it('should set debtor and creditor names', async () => {
    const result = await canonicalToFednow(sampleCanonical as Parameters<typeof canonicalToFednow>[0]);
    expect(result.FIToFICstmrCdtTrf.CdtTrfTxInf.Dbtr.Nm).toBe('Alice Johnson');
    expect(result.FIToFICstmrCdtTrf.CdtTrfTxInf.Cdtr.Nm).toBe('Bob Martinez');
  });

  it('should set correct clearing system code USABA', async () => {
    const result = await canonicalToFednow(sampleCanonical as Parameters<typeof canonicalToFednow>[0]);
    const cdtrClr = result.FIToFICstmrCdtTrf.CdtTrfTxInf.CdtrAgt.FinInstnId.ClrSysMmbId.ClrSysId.Cd;
    const dbtrClr = result.FIToFICstmrCdtTrf.CdtTrfTxInf.DbtrAgt.FinInstnId.ClrSysMmbId.ClrSysId.Cd;
    expect(cdtrClr).toBe('USABA');
    expect(dbtrClr).toBe('USABA');
  });

  it('should include BusinessMessageHeader', async () => {
    const result = await canonicalToFednow(sampleCanonical as Parameters<typeof canonicalToFednow>[0]);
    expect(result.BusinessMessageHeader).toBeDefined();
    expect(result.BusinessMessageHeader?.BizSvc).toBe('fednow');
    expect(result.BusinessMessageHeader?.MsgDefIdr).toBe('pacs.008.001.08');
  });

  it('should set LclInstrm to INST', async () => {
    const result = await canonicalToFednow(sampleCanonical as Parameters<typeof canonicalToFednow>[0]);
    expect(result.FIToFICstmrCdtTrf.CdtTrfTxInf.LclInstrm?.Prtry).toBe('INST');
  });
});
