jest.mock('../../../src/observability/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

import { PaymentRepository } from '../../../src/persistence/repositories/payment.repository';
import type { PaymentIntent } from '../../../src/domain/models/payment';

function createMockPool() {
  return { query: jest.fn() } as unknown as import('pg').Pool;
}

function makeFakePayment(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    payment_id: 'PMT-001',
    status: 'RECEIVED' as any,
    origin_rail: 'PIX',
    amount: 100,
    currency: 'BRL',
    debtor_alias: 'PIX-debtor',
    debtor_name: 'João',
    creditor_alias: 'SPEI-creditor',
    creditor_name: 'María',
    purpose: 'P2P',
    reference: 'MIPIT-POC',
    origin_payload: { raw: true },
    trace_id: 'trace-001',
    created_at: '2026-03-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('PaymentRepository', () => {
  let db: ReturnType<typeof createMockPool>;
  let repo: PaymentRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    db = createMockPool();
    repo = new PaymentRepository(db);
  });

  describe('create', () => {
    it('inserts a payment and returns the created row', async () => {
      const fake = makeFakePayment();
      (db.query as jest.Mock).mockResolvedValue({ rows: [fake] });

      const result = await repo.create(fake);

      expect(result).toEqual(fake);
      expect(db.query).toHaveBeenCalledTimes(1);
      const [sql, params] = (db.query as jest.Mock).mock.calls[0];
      expect(sql).toContain('INSERT INTO payments');
      expect(params).toHaveLength(15);
      expect(params[0]).toBe('PMT-001');
    });

    it('generates a ULID when payment_id is not provided', async () => {
      const fake = makeFakePayment();
      (db.query as jest.Mock).mockResolvedValue({ rows: [fake] });

      await repo.create({ ...fake, payment_id: undefined as any });

      const params = (db.query as jest.Mock).mock.calls[0][1];
      expect(params[0]).toBeDefined();
      expect(params[0]).not.toBe('');
    });

    it('serializes origin_payload as JSON', async () => {
      const fake = makeFakePayment({ origin_payload: { key: 'value' } });
      (db.query as jest.Mock).mockResolvedValue({ rows: [fake] });

      await repo.create(fake);

      const params = (db.query as jest.Mock).mock.calls[0][1];
      expect(params[12]).toBe('{"key":"value"}');
    });

    it('throws when db returns no rows', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rows: [] });
      await expect(repo.create(makeFakePayment())).rejects.toThrow('Failed to create payment');
    });
  });

  describe('findById', () => {
    it('returns the payment when found', async () => {
      const fake = makeFakePayment();
      (db.query as jest.Mock).mockResolvedValue({ rows: [fake] });

      const result = await repo.findById('PMT-001');
      expect(result).toEqual(fake);
    });

    it('returns null when payment does not exist', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rows: [] });

      const result = await repo.findById('nonexistent');
      expect(result).toBeNull();
    });

    it('throws when paymentId is empty', async () => {
      await expect(repo.findById('')).rejects.toThrow('Payment ID cannot be empty');
    });

    it('throws when paymentId is whitespace only', async () => {
      await expect(repo.findById('   ')).rejects.toThrow('Payment ID cannot be empty');
    });
  });

  describe('updateStatus', () => {
    it('updates status and returns the row', async () => {
      const fake = makeFakePayment({ status: 'VALIDATED' as any });
      (db.query as jest.Mock).mockResolvedValue({ rows: [fake] });

      const result = await repo.updateStatus('PMT-001', 'VALIDATED');
      expect(result.status).toBe('VALIDATED');

      const params = (db.query as jest.Mock).mock.calls[0][1];
      expect(params).toEqual(['VALIDATED', 'PMT-001']);
    });

    it('throws when paymentId is empty', async () => {
      await expect(repo.updateStatus('', 'VALIDATED')).rejects.toThrow('Payment ID cannot be empty');
    });

    it('throws when status is empty', async () => {
      await expect(repo.updateStatus('PMT-001', '')).rejects.toThrow('Status cannot be empty');
    });

    it('throws when payment not found', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rows: [] });
      await expect(repo.updateStatus('PMT-MISSING', 'VALIDATED')).rejects.toThrow('Payment not found');
    });
  });

  describe('updateCanonical', () => {
    const canonical = { payment_id: 'PMT-001', amount: { value: 100, currency: 'BRL' } } as any;

    it('updates canonical payload and returns the row', async () => {
      const fake = makeFakePayment();
      (db.query as jest.Mock).mockResolvedValue({ rows: [fake] });

      const result = await repo.updateCanonical('PMT-001', canonical, 'CANONICALIZED');
      expect(result).toEqual(fake);

      const params = (db.query as jest.Mock).mock.calls[0][1];
      expect(params[0]).toBe(JSON.stringify(canonical));
      expect(params[1]).toBe('CANONICALIZED');
      expect(params[2]).toBe('PMT-001');
    });

    it('throws when paymentId is empty', async () => {
      await expect(repo.updateCanonical('', canonical, 'X')).rejects.toThrow('Payment ID cannot be empty');
    });

    it('throws when canonical is null', async () => {
      await expect(repo.updateCanonical('PMT-001', null as any, 'X')).rejects.toThrow('Canonical payload cannot be empty');
    });
  });

  describe('updateRoute', () => {
    it('updates route and returns the row', async () => {
      const fake = makeFakePayment({ destination_rail: 'SPEI', route_rule_applied: 'rule1' });
      (db.query as jest.Mock).mockResolvedValue({ rows: [fake] });

      const result = await repo.updateRoute('PMT-001', 'SPEI', 'rule1', 'ROUTED');
      expect(result.destination_rail).toBe('SPEI');

      const params = (db.query as jest.Mock).mock.calls[0][1];
      expect(params).toEqual(['SPEI', 'rule1', 'ROUTED', 'PMT-001']);
    });

    it('throws when paymentId is empty', async () => {
      await expect(repo.updateRoute('', 'PIX', 'r', 'ROUTED')).rejects.toThrow('Payment ID cannot be empty');
    });

    it('throws when destinationRail is empty', async () => {
      await expect(repo.updateRoute('PMT-001', '', 'r', 'ROUTED')).rejects.toThrow('Destination rail cannot be empty');
    });

    it('throws when ruleName is empty', async () => {
      await expect(repo.updateRoute('PMT-001', 'PIX', '', 'ROUTED')).rejects.toThrow('Rule name cannot be empty');
    });
  });

  describe('updateTranslated', () => {
    it('updates translated payload and returns the row', async () => {
      const fake = makeFakePayment();
      (db.query as jest.Mock).mockResolvedValue({ rows: [fake] });

      const translated = { pix_key: 'abc' };
      await repo.updateTranslated('PMT-001', translated);

      const params = (db.query as jest.Mock).mock.calls[0][1];
      expect(params[0]).toBe(JSON.stringify(translated));
      expect(params[1]).toBe('PMT-001');
    });

    it('throws when translated payload is null', async () => {
      await expect(repo.updateTranslated('PMT-001', null as any)).rejects.toThrow('Translated payload cannot be empty');
    });
  });

  describe('updateRailAck', () => {
    it('updates rail ack as object', async () => {
      const fake = makeFakePayment();
      (db.query as jest.Mock).mockResolvedValue({ rows: [fake] });

      const ack = { status: 'OK', rail_ref: 'PIX-123' };
      await repo.updateRailAck('PMT-001', ack, 'COMPLETED');

      const params = (db.query as jest.Mock).mock.calls[0][1];
      expect(params[0]).toBe(JSON.stringify(ack));
      expect(params[1]).toBe('COMPLETED');
    });

    it('passes string ack directly', async () => {
      const fake = makeFakePayment();
      (db.query as jest.Mock).mockResolvedValue({ rows: [fake] });

      await repo.updateRailAck('PMT-001', '{"ok":true}', 'ACKED_BY_RAIL');

      const params = (db.query as jest.Mock).mock.calls[0][1];
      expect(params[0]).toBe('{"ok":true}');
    });

    it('defaults status to ACKED_BY_RAIL', async () => {
      const fake = makeFakePayment();
      (db.query as jest.Mock).mockResolvedValue({ rows: [fake] });

      await repo.updateRailAck('PMT-001', { ok: true });

      const params = (db.query as jest.Mock).mock.calls[0][1];
      expect(params[1]).toBe('ACKED_BY_RAIL');
    });

    it('throws when railAck is null', async () => {
      await expect(repo.updateRailAck('PMT-001', null as any)).rejects.toThrow('Rail ACK response cannot be empty');
    });
  });

  describe('updateAck (deprecated)', () => {
    it('delegates to updateRailAck', async () => {
      const fake = makeFakePayment();
      (db.query as jest.Mock).mockResolvedValue({ rows: [fake] });

      await repo.updateAck('PMT-001', { ack: true }, 'COMPLETED');

      expect(db.query).toHaveBeenCalledTimes(1);
      const params = (db.query as jest.Mock).mock.calls[0][1];
      expect(params[1]).toBe('COMPLETED');
    });
  });
});
