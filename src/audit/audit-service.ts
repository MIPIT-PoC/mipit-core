import { ulid } from 'ulid';
import type { AuditEvent } from '../domain/models/audit-event.js';
import type { AuditRepository } from '../persistence/repositories/audit.repository.js';
import { logger } from '../observability/logger.js';

export class AuditService {
  constructor(private readonly repo: AuditRepository) {}

  async log(
    paymentId: string,
    eventType: string,
    stage: string,
    traceId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const event: AuditEvent = {
      id: ulid(),
      payment_id: paymentId,
      event_type: eventType,
      stage,
      trace_id: traceId,
      metadata,
      created_at: new Date().toISOString(),
    };

    await this.repo.insert(event);

    logger.debug(
      { payment_id: paymentId, event_type: eventType, stage },
      'Audit event recorded',
    );
  }
}
