import { speiToCanonical } from '../../../src/translation/spei-to-canonical.js';

describe('speiToCanonical', () => {
  const sampleSpeiPayload = {
    amount: 5000,
    currency: 'MXN',
    debtor: { alias: 'SPEI-CLABE-sender-789', name: 'Carlos López' },
    creditor: { alias: 'PIX-receiver-key-012', name: 'Ana Souza' },
    purpose: 'P2P',
    reference: 'TEST-002',
  };

  it.todo('should translate a SPEI payload to canonical pacs.008 format');

  it.todo('should set origin.rail to SPEI');

  it.todo('should map CLABE-based alias to debtor.account_id');

  it.todo('should set alias.type to CLABE');

  it.todo('should throw TranslationError for invalid SPEI payloads');
});
