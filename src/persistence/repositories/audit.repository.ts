import type { Pool } from 'pg';
import type { AuditEvent } from '../../domain/models/audit-event.js';
import { SQL } from '../queries/index.js';

export class AuditRepository {
  constructor(private readonly db: Pool) {}

  async insert(event: AuditEvent): Promise<void> {
    await this.db.query(SQL.INSERT_AUDIT_EVENT, [
      event.id,
      event.payment_id,
      event.event_type,
      event.stage,
      event.trace_id,
      event.metadata ? JSON.stringify(event.metadata) : null,
      event.created_at,
    ]);
  }

  async findByPaymentId(paymentId: string): Promise<AuditEvent[]> {
    const result = await this.db.query(SQL.FIND_AUDIT_BY_PAYMENT_ID, [paymentId]);
    return result.rows as AuditEvent[];
  }
}
