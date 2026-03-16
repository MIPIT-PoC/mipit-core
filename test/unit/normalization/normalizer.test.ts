jest.mock('../../../src/observability/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    child: jest.fn(() => ({
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    })),
  },
}));

jest.mock('../../../src/observability/metrics.js', () => ({
  startLatencyTimer: jest.fn(() => jest.fn()),
}));

import { Normalizer } from '../../../src/normalization/normalizer.js';
import type { CanonicalPacs008 } from '../../../src/domain/models/canonical.js';

function makeCanonical(overrides: Partial<CanonicalPacs008> = {}): CanonicalPacs008 {
  return {
    payment_id: 'PMT-ABCDEFGHIJ1234567890',
    created_at: '2025-06-15T12:00:00.000Z',
    grpHdr: { msgId: 'MSG-001', creDtTm: '2025-06-15T12:00:00.000Z' },
    pmtId: { endToEndId: 'E2E-001' },
    amount: { value: 100, currency: 'BRL' },
    fx: { source_currency: 'BRL' },
    origin: { rail: 'PIX' },
    destination: {},
    debtor: { name: 'João', country: 'BR', account_id: 'PIX-d1' },
    creditor: { name: 'María', country: 'MX', account_id: 'CLABE-c1' },
    alias: { type: 'PIX_KEY', value: 'd1' },
    purpose: 'P2P',
    reference: 'MIPIT-POC',
    status: 'RECEIVED',
    ...overrides,
  } as CanonicalPacs008;
}

describe('Normalizer', () => {
  let normalizer: Normalizer;

  beforeEach(() => {
    normalizer = new Normalizer();
  });

  it('should normalize dates to UTC ISO-8601 format', async () => {
    const input = makeCanonical({
      created_at: '2025-06-15T19:30:00.000Z',
      grpHdr: { msgId: 'MSG-001', creDtTm: '2025-06-15T19:30:00.000Z' },
    });
    const result = await normalizer.normalize(input);
    expect(result.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });

  it('should not crash on invalid dates (keeps original)', async () => {
    const input = makeCanonical();
    (input as any).created_at = 'not-a-date';
    const result = await normalizer.normalize(input);
    expect(result.created_at).toBe('not-a-date');
  });

  it('should uppercase currency codes', async () => {
    const input = makeCanonical();
    (input.amount as any).currency = 'brl';
    const result = await normalizer.normalize(input);
    expect(result.amount.currency).toBe('BRL');
  });

  it('should set FX target_currency for PIX with non-BRL currency', async () => {
    const input = makeCanonical({
      amount: { value: 100, currency: 'USD' },
      origin: { rail: 'PIX' },
    });
    const result = await normalizer.normalize(input);
    expect(result.fx?.source_currency).toBe('BRL');
    expect(result.fx?.target_currency).toBe('USD');
  });

  it('should not set FX target when currency matches local rail currency', async () => {
    const input = makeCanonical({
      amount: { value: 100, currency: 'BRL' },
      origin: { rail: 'PIX' },
    });
    const result = await normalizer.normalize(input);
    expect(result.fx?.target_currency).toBeUndefined();
  });

  it('should set FX for SPEI with non-MXN currency', async () => {
    const input = makeCanonical({
      amount: { value: 100, currency: 'BRL' },
      origin: { rail: 'SPEI' },
      fx: { source_currency: 'MXN' },
    });
    const result = await normalizer.normalize(input);
    expect(result.fx?.source_currency).toBe('MXN');
    expect(result.fx?.target_currency).toBe('BRL');
  });

  it('should populate missing msgId with generated value', async () => {
    const input = makeCanonical({ grpHdr: { msgId: '', creDtTm: '2025-06-15T12:00:00.000Z' } });
    const result = await normalizer.normalize(input);
    expect(result.grpHdr.msgId).toMatch(/^MSG-/);
  });

  it('should populate missing endToEndId with generated value', async () => {
    const input = makeCanonical({ pmtId: { endToEndId: '' } });
    const result = await normalizer.normalize(input);
    expect(result.pmtId.endToEndId).toMatch(/^E2E-/);
  });

  it('should apply default purpose P2P when empty', async () => {
    const input = makeCanonical({ purpose: '' });
    const result = await normalizer.normalize(input);
    expect(result.purpose).toBe('P2P');
  });

  it('should apply default reference MIPIT-POC when empty', async () => {
    const input = makeCanonical({ reference: '' });
    const result = await normalizer.normalize(input);
    expect(result.reference).toBe('MIPIT-POC');
  });

  it('should not modify already-normalized fields', async () => {
    const input = makeCanonical();
    const result = await normalizer.normalize(input);
    expect(result.amount.currency).toBe('BRL');
    expect(result.purpose).toBe('P2P');
    expect(result.reference).toBe('MIPIT-POC');
  });
});
