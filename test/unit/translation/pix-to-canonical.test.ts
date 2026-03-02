import { pixToCanonical } from '../../../src/translation/pix-to-canonical.js';

describe('pixToCanonical', () => {
  const samplePixPayload = {
    amount: 100.5,
    currency: 'BRL',
    debtor: { alias: 'PIX-debtor-key-123', name: 'João Silva' },
    creditor: { alias: 'SPEI-CLABE-456', name: 'María García' },
    purpose: 'P2P',
    reference: 'TEST-001',
  };

  it.todo('should translate a PIX payload to canonical pacs.008 format');

  it.todo('should set origin.rail to PIX');

  it.todo('should map debtor alias to debtor.account_id');

  it.todo('should map creditor alias to creditor.account_id');

  it.todo('should set alias.type to PIX_KEY');

  it.todo('should throw TranslationError for invalid PIX payloads');
});
