jest.mock('../../../src/observability/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

import { pixToCanonical } from '../../../src/translation/pix-to-canonical.js';
import { TranslationError } from '../../../src/domain/errors/index.js';

const VALID_PAYMENT_ID = 'PMT-ABCDEFGHIJ1234567890';

const baseRequest = {
  amount: 100.5,
  currency: 'BRL',
  debtor: { alias: 'PIX-debtor-key-123', name: 'João Silva' },
  creditor: { alias: 'PIX-abc123', name: 'María García' },
  purpose: 'P2P',
  reference: 'TEST-001',
};

describe('pixToCanonical', () => {
  it('should translate a valid PIX payload to canonical pacs.008', async () => {
    const result = await pixToCanonical(baseRequest, VALID_PAYMENT_ID, 'trace-1');

    expect(result.payment_id).toBe(VALID_PAYMENT_ID);
    expect(result.origin.rail).toBe('PIX');
    expect(result.alias.type).toBe('PIX_KEY');
    expect(result.amount.value).toBe(100.5);
    expect(result.amount.currency).toBe('BRL');
    expect(result.status).toBe('RECEIVED');
    expect(result.trace_id).toBe('trace-1');
    expect(result.grpHdr.msgId).toMatch(/^MSG-/);
    expect(result.pmtId.endToEndId).toMatch(/^E2E-/);
  });

  it('should extract alias value by stripping PIX- prefix', async () => {
    const result = await pixToCanonical(baseRequest, VALID_PAYMENT_ID);
    expect(result.alias.value).toBe('abc123');
  });

  it('should keep alias value as-is if no PIX- prefix', async () => {
    const req = { ...baseRequest, creditor: { ...baseRequest.creditor, alias: 'rawkey' } };
    const result = await pixToCanonical(req, VALID_PAYMENT_ID);
    expect(result.alias.value).toBe('rawkey');
  });

  it('should default currency to BRL when not provided', async () => {
    const req = { ...baseRequest, currency: undefined };
    const result = await pixToCanonical(req, VALID_PAYMENT_ID);
    expect(result.amount.currency).toBe('BRL');
  });

  it('should throw TranslationError for negative amount', async () => {
    const req = { ...baseRequest, amount: -10 };
    await expect(pixToCanonical(req, VALID_PAYMENT_ID)).rejects.toThrow(TranslationError);
  });

  it('should include trace_id when provided', async () => {
    const result = await pixToCanonical(baseRequest, VALID_PAYMENT_ID, 'my-trace');
    expect(result.trace_id).toBe('my-trace');
  });

  it('should leave trace_id undefined when not provided', async () => {
    const result = await pixToCanonical(baseRequest, VALID_PAYMENT_ID);
    expect(result.trace_id).toBeUndefined();
  });
});
