jest.mock('../../../src/observability/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

import { AuditService } from '../../../src/audit/audit-service';
import type { AuditRepository } from '../../../src/persistence/repositories/audit.repository';
import { logger } from '../../../src/observability/logger';

function createMockRepo(): jest.Mocked<AuditRepository> {
  return {
    insert: jest.fn().mockResolvedValue(undefined),
    findByPaymentId: jest.fn().mockResolvedValue([]),
    logStatusChange: jest.fn().mockResolvedValue(undefined),
    logRoutingDecision: jest.fn().mockResolvedValue(undefined),
    logError: jest.fn().mockResolvedValue(undefined),
    logAckReceived: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditRepository>;
}

describe('AuditService', () => {
  let repo: jest.Mocked<AuditRepository>;
  let service: AuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = createMockRepo();
    service = new AuditService(repo);
  });

  describe('log', () => {
    it('delegates to repo.insert and logs debug', async () => {
      await service.log('PMT-001', 'STATUS_CHANGE', 'system', { key: 'val' }, 'trace-001');

      expect(repo.insert).toHaveBeenCalledWith({
        payment_id: 'PMT-001',
        event_type: 'STATUS_CHANGE',
        actor: 'system',
        detail: { key: 'val' },
        trace_id: 'trace-001',
      });

      expect(logger.debug).toHaveBeenCalledWith(
        { payment_id: 'PMT-001', event_type: 'STATUS_CHANGE', actor: 'system' },
        'Audit event recorded',
      );
    });

    it('passes undefined trace_id when not provided', async () => {
      await service.log('PMT-002', 'ACK_RECEIVED', 'adapter', { ack: true });

      expect(repo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ trace_id: undefined }),
      );
    });
  });

  describe('logStatusChange', () => {
    it('delegates to repo.logStatusChange with all params', async () => {
      await service.logStatusChange('PMT-001', 'RECEIVED', 'VALIDATED', 'system', 'trace-001');

      expect(repo.logStatusChange).toHaveBeenCalledWith(
        'PMT-001', 'RECEIVED', 'VALIDATED', 'system', 'trace-001',
      );

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_id: 'PMT-001',
          from_status: 'RECEIVED',
          to_status: 'VALIDATED',
        }),
        'Status change recorded',
      );
    });
  });

  describe('logRoutingDecision', () => {
    it('delegates to repo.logRoutingDecision', async () => {
      await service.logRoutingDecision('PMT-001', 'PIX', 'pix_key_route', 'system-router', 'trace-001');

      expect(repo.logRoutingDecision).toHaveBeenCalledWith(
        'PMT-001', 'PIX', 'pix_key_route', 'system-router', 'trace-001',
      );

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_id: 'PMT-001',
          destination_rail: 'PIX',
          rule_name: 'pix_key_route',
        }),
        'Routing decision recorded',
      );
    });
  });

  describe('logError', () => {
    it('delegates to repo.logError with Error object', async () => {
      const err = new Error('something broke');
      await service.logError('PMT-001', 'VALIDATION_ERROR', err, 'system', 'trace-001');

      expect(repo.logError).toHaveBeenCalledWith(
        'PMT-001', 'VALIDATION_ERROR', err, 'system', 'trace-001',
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_id: 'PMT-001',
          error_message: 'something broke',
        }),
        'Error event recorded',
      );
    });

    it('handles string errors', async () => {
      await service.logError('PMT-001', 'ROUTING_ERROR', 'no match', 'system');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error_message: 'no match' }),
        'Error event recorded',
      );
    });
  });

  describe('logAckReceived', () => {
    it('delegates to repo.logAckReceived', async () => {
      const ack = { rail_ref: 'PIX-123', status: 'OK' };
      await service.logAckReceived('PMT-001', ack, 'adapter-pix', 'trace-001');

      expect(repo.logAckReceived).toHaveBeenCalledWith(
        'PMT-001', ack, 'adapter-pix', 'trace-001',
      );

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_id: 'PMT-001',
          actor: 'adapter-pix',
          ack_received: true,
        }),
        'ACK event recorded',
      );
    });
  });
});
