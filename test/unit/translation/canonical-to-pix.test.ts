jest.mock('../../../src/observability/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

import { canonicalToPix } from '../../../src/translation/canonical-to-pix.js';
import type { CanonicalPacs008 } from '../../../src/domain/models/canonical.js';

const canonical: CanonicalPacs008 = {
  payment_id: 'PMT-ABCDEFGHIJ1234567890',
  created_at: '2025-06-15T12:00:00.000Z',
  grpHdr: { msgId: 'MSG-001', creDtTm: '2025-06-15T12:00:00.000Z' },
  pmtId: { endToEndId: 'E2E-001' },
  amount: { value: 250.0, currency: 'BRL' },
  fx: { source_currency: 'BRL' },
  origin: { rail: 'PIX' },
  destination: {},
  debtor: { name: 'João Silva', country: 'BR', account_id: 'PIX-debtor-123' },
  creditor: { name: 'María García', country: 'MX', account_id: 'CLABE-cred-456' },
  alias: { type: 'PIX_KEY', value: 'debtor-123' },
  purpose: 'P2P',
  reference: 'REF-001',
  status: 'RECEIVED',
};

describe('canonicalToPix', () => {
  it('should produce correct PixOutboundPayload', async () => {
    const result = await canonicalToPix(canonical);

    expect(result.endToEndId).toBe('E2E-001');
    expect(result.pixKey).toBe('debtor-123');
    expect(result.amount).toBe(250.0);
    expect(result.currency).toBe('BRL');
    expect(result.debtorName).toBe('João Silva');
    expect(result.debtorAccount).toBe('PIX-debtor-123');
    expect(result.creditorName).toBe('María García');
    expect(result.creditorAccount).toBe('CLABE-cred-456');
    expect(result.purpose).toBe('P2P');
    expect(result.reference).toBe('REF-001');
    expect(result.createdAt).toBe('2025-06-15T12:00:00.000Z');
  });

  it('should handle missing optional debtor/creditor names', async () => {
    const c = { ...canonical, debtor: { ...canonical.debtor, name: undefined }, creditor: { ...canonical.creditor, name: undefined } };
    const result = await canonicalToPix(c as CanonicalPacs008);
    expect(result.debtorName).toBeUndefined();
    expect(result.creditorName).toBeUndefined();
  });
});
