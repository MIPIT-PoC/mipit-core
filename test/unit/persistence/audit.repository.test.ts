jest.mock('../../../src/observability/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

import { AuditRepository } from '../../../src/persistence/repositories/audit.repository';
import type { AuditEvent } from '../../../src/domain/models/audit-event';

function createMockPool() {
  return { query: jest.fn() } as unknown as import('pg').Pool;
}

describe('AuditRepository', () => {
  let db: ReturnType<typeof createMockPool>;
  let repo: AuditRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    db = createMockPool();
    repo = new AuditRepository(db);
  });

  describe('insert', () => {
    it('inserts a valid audit event with 7 parameters', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rowCount: 1 });

      await repo.insert({
        payment_id: 'PMT-001',
        event_type: 'STATUS_CHANGE',
        actor: 'system',
        detail: { from: 'RECEIVED', to: 'VALIDATED' },
        trace_id: 'trace-001',
      });

      expect(db.query).toHaveBeenCalledTimes(1);
      const params = (db.query as jest.Mock).mock.calls[0][1];
      expect(params).toHaveLength(7);
      expect(params[0]).toBeDefined(); // auto-generated ULID
      expect(params[1]).toBe('PMT-001');
      expect(params[2]).toBe('STATUS_CHANGE');
      expect(params[3]).toBe('system');
      expect(params[4]).toBe('{"from":"RECEIVED","to":"VALIDATED"}');
      expect(params[5]).toBe('trace-001');
      expect(params[6]).toBeDefined(); // auto-generated created_at
    });

    it('uses provided id and created_at when given', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rowCount: 1 });

      await repo.insert({
        id: 'EVT-CUSTOM',
        payment_id: 'PMT-002',
        event_type: 'ACK_RECEIVED',
        actor: 'adapter-pix',
        detail: { ack: true },
        created_at: '2026-03-15T10:00:00.000Z',
      });

      const params = (db.query as jest.Mock).mock.calls[0][1];
      expect(params[0]).toBe('EVT-CUSTOM');
      expect(params[6]).toBe('2026-03-15T10:00:00.000Z');
    });

    it('throws when payment_id is empty', async () => {
      await expect(
        repo.insert({ payment_id: '', event_type: 'X', actor: 'Y', detail: { a: 1 } }),
      ).rejects.toThrow('Payment ID cannot be empty');
    });

    it('throws when event_type is empty', async () => {
      await expect(
        repo.insert({ payment_id: 'PMT-1', event_type: '', actor: 'Y', detail: { a: 1 } }),
      ).rejects.toThrow('Event type cannot be empty');
    });

    it('throws when actor is empty', async () => {
      await expect(
        repo.insert({ payment_id: 'PMT-1', event_type: 'X', actor: '', detail: { a: 1 } }),
      ).rejects.toThrow('Actor cannot be empty');
    });

    it('throws when detail is empty object', async () => {
      await expect(
        repo.insert({ payment_id: 'PMT-1', event_type: 'X', actor: 'Y', detail: {} }),
      ).rejects.toThrow('Event detail cannot be empty');
    });

    it('throws when db insert returns rowCount 0', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rowCount: 0 });

      await expect(
        repo.insert({
          payment_id: 'PMT-003',
          event_type: 'X',
          actor: 'Y',
          detail: { a: 1 },
        }),
      ).rejects.toThrow('Failed to insert audit event');
    });

    it('passes string detail directly without double-encoding', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rowCount: 1 });

      await repo.insert({
        payment_id: 'PMT-1',
        event_type: 'X',
        actor: 'Y',
        detail: '{"already":"json"}' as any,
      });

      const params = (db.query as jest.Mock).mock.calls[0][1];
      expect(params[4]).toBe('{"already":"json"}');
    });
  });

  describe('findByPaymentId', () => {
    it('returns audit events for a payment', async () => {
      const events: AuditEvent[] = [
        {
          id: 'EVT-1',
          payment_id: 'PMT-001',
          event_type: 'STATUS_CHANGE',
          actor: 'system',
          detail: { from: 'RECEIVED', to: 'VALIDATED' },
          created_at: '2026-03-15T10:00:00.000Z',
        },
        {
          id: 'EVT-2',
          payment_id: 'PMT-001',
          event_type: 'ROUTE_DECISION',
          actor: 'system-router',
          detail: { destination_rail: 'PIX' },
          created_at: '2026-03-15T10:00:01.000Z',
        },
      ];
      (db.query as jest.Mock).mockResolvedValue({ rows: events });

      const result = await repo.findByPaymentId('PMT-001');
      expect(result).toHaveLength(2);
      expect(result[0].event_type).toBe('STATUS_CHANGE');
    });

    it('returns empty array when no events exist', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rows: [] });

      const result = await repo.findByPaymentId('PMT-NONE');
      expect(result).toEqual([]);
    });

    it('throws when paymentId is empty', async () => {
      await expect(repo.findByPaymentId('')).rejects.toThrow('Payment ID cannot be empty');
    });

    it('uses SQL ordered by created_at ASC', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rows: [] });

      await repo.findByPaymentId('PMT-001');

      const sql = (db.query as jest.Mock).mock.calls[0][0] as string;
      expect(sql).toContain('ORDER BY created_at ASC');
    });
  });

  describe('logStatusChange', () => {
    it('delegates to insert with correct structure', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rowCount: 1 });

      await repo.logStatusChange('PMT-001', 'RECEIVED', 'VALIDATED', 'system', 'trace-001');

      const params = (db.query as jest.Mock).mock.calls[0][1];
      expect(params[2]).toBe('STATUS_CHANGE');
      expect(params[3]).toBe('system');
      const detail = JSON.parse(params[4]);
      expect(detail.from_status).toBe('RECEIVED');
      expect(detail.to_status).toBe('VALIDATED');
    });
  });

  describe('logRoutingDecision', () => {
    it('delegates to insert with route detail', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rowCount: 1 });

      await repo.logRoutingDecision('PMT-001', 'PIX', 'pix_key_route', 'system-router');

      const params = (db.query as jest.Mock).mock.calls[0][1];
      expect(params[2]).toBe('ROUTE_DECISION');
      const detail = JSON.parse(params[4]);
      expect(detail.destination_rail).toBe('PIX');
      expect(detail.rule_name).toBe('pix_key_route');
    });
  });

  describe('logError', () => {
    it('handles Error objects', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rowCount: 1 });

      await repo.logError('PMT-001', 'VALIDATION_ERROR', new Error('bad data'), 'system');

      const params = (db.query as jest.Mock).mock.calls[0][1];
      const detail = JSON.parse(params[4]);
      expect(detail.error_message).toBe('bad data');
      expect(detail.error_stack).toBeDefined();
    });

    it('handles string errors', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rowCount: 1 });

      await repo.logError('PMT-001', 'ROUTING_ERROR', 'no rule matched', 'system');

      const params = (db.query as jest.Mock).mock.calls[0][1];
      const detail = JSON.parse(params[4]);
      expect(detail.error_message).toBe('no rule matched');
      expect(detail.error_stack).toBeUndefined();
    });
  });

  describe('logAckReceived', () => {
    it('handles object ACK responses', async () => {
      (db.query as jest.Mock).mockResolvedValue({ rowCount: 1 });

      await repo.logAckReceived('PMT-001', { status: 'OK', rail_ref: 'PIX-123' }, 'adapter-pix');

      const params = (db.query as jest.Mock).mock.calls[0][1];
      expect(params[2]).toBe('ACK_RECEIVED');
      const detail = JSON.parse(params[4]);
      expect(detail.ack_response).toEqual({ status: 'OK', rail_ref: 'PIX-123' });
    });
  });
});
