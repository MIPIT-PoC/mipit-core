import { createPaymentSchema } from '../../../src/api/schemas/payment-request';
import { paymentDetailSchema, paymentAcceptedSchema } from '../../../src/api/schemas/payment-response';

describe('Payment schemas', () => {
  describe('createPaymentSchema', () => {
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

    it('should reject currency with wrong length', () => {
      const invalid = {
        amount: 100,
        currency: 'US',
        debtor: { alias: 'PIX-key-123' },
        creditor: { alias: 'SPEI-CLABE-456' },
      };

      const result = createPaymentSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('paymentAcceptedSchema', () => {
    it('should validate a proper accepted response', () => {
      const response = {
        payment_id: 'PMT-123',
        status: 'QUEUED',
        received_at: '2026-03-01T12:00:00.000Z',
        destination: 'SPEI',
      };

      expect(paymentAcceptedSchema.safeParse(response).success).toBe(true);
    });
  });

  describe('paymentDetailSchema', () => {
    it('should validate a full payment detail', () => {
      const detail = {
        payment_id: 'PMT-123',
        status: 'COMPLETED',
        origin: 'PIX',
        destination: 'SPEI',
        amount: 100,
        currency: 'BRL',
        original: {},
        canonical: null,
        translated: null,
        rail_ack: null,
        timestamps: {
          created_at: '2026-03-01T12:00:00.000Z',
          validated_at: null,
          canonicalized_at: null,
          routed_at: null,
          queued_at: null,
          sent_at: null,
          acked_at: null,
          completed_at: null,
        },
      };

      expect(paymentDetailSchema.safeParse(detail).success).toBe(true);
    });
  });
});
