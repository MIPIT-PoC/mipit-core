jest.mock('../../../src/observability/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

import { canonicalToSpei } from '../../../src/translation/canonical-to-spei.js';
import type { CanonicalPacs008 } from '../../../src/domain/models/canonical.js';

const canonical: CanonicalPacs008 = {
  payment_id: 'PMT-ABCDEFGHIJ1234567890',
  created_at: '2025-06-15T12:00:00.000Z',
  grpHdr: { msgId: 'MSG-001', creDtTm: '2025-06-15T12:00:00.000Z' },
  pmtId: { endToEndId: 'E2E-002' },
  amount: { value: 5000.0, currency: 'MXN' },
  fx: { source_currency: 'MXN' },
  origin: { rail: 'SPEI' },
  destination: {},
  debtor: { name: 'Carlos López', country: 'MX', account_id: 'SPEI-sender-789' },
  creditor: { name: 'Ana Souza', country: 'BR', account_id: 'PIX-receiver-012' },
  alias: { type: 'CLABE', value: '012345678901234567' },
  purpose: 'P2P',
  reference: 'REF-002',
  status: 'RECEIVED',
};

describe('canonicalToSpei', () => {
  it('should produce correct SpeiOutboundPayload', async () => {
    const result = await canonicalToSpei(canonical);

    expect(result.claveRastreo).toBe('E2E-002');
    expect(result.clabe).toBe('012345678901234567');
    expect(result.monto).toBe(5000.0);
    expect(result.moneda).toBe('MXN');
    expect(result.nombreOrdenante).toBe('Carlos López');
    expect(result.cuentaOrdenante).toBe('SPEI-sender-789');
    expect(result.nombreBeneficiario).toBe('Ana Souza');
    expect(result.cuentaBeneficiario).toBe('PIX-receiver-012');
    expect(result.concepto).toBe('P2P');
    expect(result.referencia).toBe('REF-002');
  });

  it('should format fechaOperacion as YYYY-MM-DD only', async () => {
    const result = await canonicalToSpei(canonical);
    expect(result.fechaOperacion).toBe('2025-06-15');
  });

  it('should handle missing optional names', async () => {
    const c = { ...canonical, debtor: { ...canonical.debtor, name: undefined }, creditor: { ...canonical.creditor, name: undefined } };
    const result = await canonicalToSpei(c as CanonicalPacs008);
    expect(result.nombreOrdenante).toBeUndefined();
    expect(result.nombreBeneficiario).toBeUndefined();
  });
});
