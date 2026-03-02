import { createPaymentSchema } from '../../../src/api/schemas/payment-request.js';

describe('POST /payments', () => {
  describe('createPaymentSchema validation', () => {
    it('should accept a valid payment request', () => {
      const valid = {
        amount: 100,
        currency: 'USD',
        debtor: { alias: 'PIX-key-123', name: 'Sender' },
        creditor: { alias: 'SPEI-CLABE-456', name: 'Receiver' },
      };

      const result = createPaymentSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should reject amount <= 0', () => {
      const invalid = {
        amount: -10,
        currency: 'USD',
        debtor: { alias: 'PIX-key-123' },
        creditor: { alias: 'SPEI-CLABE-456' },
      };

      const result = createPaymentSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject missing debtor alias', () => {
      const invalid = {
        amount: 100,
        currency: 'USD',
        debtor: { alias: '' },
        creditor: { alias: 'SPEI-CLABE-456' },
      };

      const result = createPaymentSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should default currency to USD', () => {
      const noCurrency = {
        amount: 100,
        debtor: { alias: 'PIX-key-123' },
        creditor: { alias: 'SPEI-CLABE-456' },
      };

      const result = createPaymentSchema.parse(noCurrency);
      expect(result.currency).toBe('USD');
    });

    it('should default purpose to P2P', () => {
      const noPurpose = {
        amount: 100,
        debtor: { alias: 'PIX-key-123' },
        creditor: { alias: 'SPEI-CLABE-456' },
      };

      const result = createPaymentSchema.parse(noPurpose);
      expect(result.purpose).toBe('P2P');
    });
  });

  describe('route handler', () => {
    it.todo('should return 202 with payment_id and status');

    it.todo('should return 404 for non-existent payment GET');

    it.todo('should propagate idempotency-key header');
  });
});
