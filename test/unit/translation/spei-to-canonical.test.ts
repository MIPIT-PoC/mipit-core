jest.mock('../../../src/observability/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

import { speiToCanonical } from '../../../src/translation/spei-to-canonical.js';
import { TranslationError } from '../../../src/domain/errors/index.js';

const VALID_PAYMENT_ID = 'PMT-ABCDEFGHIJ1234567890';

const baseRequest = {
  amount: 5000,
  currency: 'MXN',
  debtor: { alias: 'SPEI-sender-789', name: 'Carlos López' },
  creditor: { alias: 'CLABE-012345678901234567', name: 'Ana Souza' },
  purpose: 'P2P',
  reference: 'TEST-002',
};

describe('speiToCanonical', () => {
  it('should translate a valid SPEI payload to canonical pacs.008', async () => {
    const result = await speiToCanonical(baseRequest, VALID_PAYMENT_ID, 'trace-2');

    expect(result.payment_id).toBe(VALID_PAYMENT_ID);
    expect(result.origin.rail).toBe('SPEI');
    expect(result.alias.type).toBe('CLABE');
    expect(result.amount.value).toBe(5000);
    expect(result.amount.currency).toBe('MXN');
    expect(result.status).toBe('RECEIVED');
    expect(result.trace_id).toBe('trace-2');
  });

  it('should extract alias value by stripping CLABE- prefix', async () => {
    const result = await speiToCanonical(baseRequest, VALID_PAYMENT_ID);
    expect(result.alias.value).toBe('012345678901234567');
  });

  it('should keep alias value as-is if no CLABE- prefix', async () => {
    const req = { ...baseRequest, creditor: { ...baseRequest.creditor, alias: 'rawclabe' } };
    const result = await speiToCanonical(req, VALID_PAYMENT_ID);
    expect(result.alias.value).toBe('rawclabe');
  });

  it('should default currency to MXN when not provided', async () => {
    const req = { ...baseRequest, currency: undefined };
    const result = await speiToCanonical(req, VALID_PAYMENT_ID);
    expect(result.amount.currency).toBe('MXN');
  });

  it('should throw TranslationError for negative amount', async () => {
    const req = { ...baseRequest, amount: -10 };
    await expect(speiToCanonical(req, VALID_PAYMENT_ID)).rejects.toThrow(TranslationError);
  });

  it('should set debtor country to MX', async () => {
    const result = await speiToCanonical(baseRequest, VALID_PAYMENT_ID);
    expect(result.debtor.country).toBe('MX');
  });
});
