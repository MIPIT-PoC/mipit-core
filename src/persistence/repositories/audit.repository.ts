import { ulid } from 'ulid';
import type { Pool } from 'pg';
import type { AuditEvent } from '../../domain/models/audit-event.js';
import { SQL } from '../queries/index.js';

export class AuditRepository {
  constructor(private readonly db: Pool) {}

  /**
   * Generate a ULID for audit event ID
   * @returns A new ULID string
   */
  private generateEventId(): string {
    return ulid();
  }

  /**
   * Insert a new audit event for tracking payment lifecycle
   * 
   * Audit events are immutable records of important actions and state changes
   * during payment processing. They provide complete traceability for debugging
   * and regulatory compliance.
   * 
   * @param event Partial audit event (id and created_at auto-generated if not provided)
   * @returns void (audit events are write-only)
   * 
   * @example
   * ```typescript
   * await auditRepo.insert({
   *   payment_id: '01ARZ3NDEKTSV4RRFFQ7',
   *   event_type: 'STATUS_CHANGE',
   *   actor: 'system-validator',
   *   detail: {
   *     from_status: 'RECEIVED',
   *     to_status: 'VALIDATED',
   *     validation_duration_ms: 150
   *   },
   *   trace_id: 'trace-abc123'
   * });
   * ```
   */
  async insert(event: Partial<AuditEvent>): Promise<void> {
    if (!event.payment_id || event.payment_id.trim() === '') {
      throw new Error('Payment ID cannot be empty');
    }
    if (!event.event_type || event.event_type.trim() === '') {
      throw new Error('Event type cannot be empty');
    }
    if (!event.actor || event.actor.trim() === '') {
      throw new Error('Actor cannot be empty');
    }
    if (!event.detail || Object.keys(event.detail).length === 0) {
      throw new Error('Event detail cannot be empty');
    }

    // Generate ID if not provided
    const id = event.id || this.generateEventId();

    // Ensure created_at is set
    const created_at = event.created_at || new Date().toISOString();

    // Convert detail to JSON string
    const detailJson = typeof event.detail === 'string'
      ? event.detail
      : JSON.stringify(event.detail);

    const result = await this.db.query(SQL.INSERT_AUDIT, [
      id,
      event.payment_id,
      event.event_type,
      event.actor,
      detailJson, // Will be cast to jsonb by ::jsonb in query
      event.trace_id,
      created_at,
    ]);

    if (!result.rowCount || result.rowCount === 0) {
      throw new Error(`Failed to insert audit event for payment: ${event.payment_id}`);
    }
  }

  /**
   * Find all audit events for a specific payment, ordered by creation time
   * 
   * Returns a complete audit trail for a payment, showing the sequence of
   * events and state changes in chronological order.
   * 
   * @param paymentId The payment ID to find events for
   * @returns Array of AuditEvent objects, ordered by created_at ascending
   * 
   * @example
   * ```typescript
   * const events = await auditRepo.findByPaymentId('01ARZ3NDEKTSV4RRFFQ7');
   * 
   * // events array:
   * // [
   * //   {
   * //     id: '01ARZ3NDEKTSV4RRRFFF',
   * //     payment_id: '01ARZ3NDEKTSV4RRFFQ7',
   * //     event_type: 'STATUS_CHANGE',
   * //     actor: 'system-validator',
   * //     detail: { from_status: 'RECEIVED', to_status: 'VALIDATED' },
   * //     created_at: '2026-03-13T10:30:00Z'
   * //   },
   * //   {
   * //     id: '01ARZ3NDEKTSV4RRSGGG',
   * //     payment_id: '01ARZ3NDEKTSV4RRFFQ7',
   * //     event_type: 'CANONICAL_UPDATED',
   * //     actor: 'system',
   * //     detail: { fields_normalized: 5, pacs008_version: '008' },
   * //     created_at: '2026-03-13T10:30:05Z'
   * //   },
   * //   // ... more events in chronological order
   * // ]
   * ```
   */
  async findByPaymentId(paymentId: string): Promise<AuditEvent[]> {
    if (!paymentId || paymentId.trim() === '') {
      throw new Error('Payment ID cannot be empty');
    }

    const result = await this.db.query(SQL.FIND_AUDITS_BY_PAYMENT, [paymentId]);

    return result.rows as AuditEvent[];
  }

  /**
   * Helper method to log a status change event
   * 
   * Convenience method for logging payment status transitions
   * 
   * @param paymentId The payment ID
   * @param fromStatus Previous status
   * @param toStatus New status
   * @param actor Who made the change
   * @param traceId Optional trace ID for correlation
   */
  async logStatusChange(
    paymentId: string,
    fromStatus: string,
    toStatus: string,
    actor: string,
    traceId?: string
  ): Promise<void> {
    await this.insert({
      payment_id: paymentId,
      event_type: 'STATUS_CHANGE',
      actor,
      detail: {
        from_status: fromStatus,
        to_status: toStatus,
        timestamp: new Date().toISOString(),
      },
      trace_id: traceId,
    });
  }

  /**
   * Helper method to log a routing decision event
   * 
   * @param paymentId The payment ID
   * @param destinationRail The selected rail (PIX, SPEI, etc.)
   * @param ruleName The routing rule that matched
   * @param actor Who made the decision
   * @param traceId Optional trace ID
   */
  async logRoutingDecision(
    paymentId: string,
    destinationRail: string,
    ruleName: string,
    actor: string,
    traceId?: string
  ): Promise<void> {
    await this.insert({
      payment_id: paymentId,
      event_type: 'ROUTE_DECISION',
      actor,
      detail: {
        destination_rail: destinationRail,
        rule_name: ruleName,
        timestamp: new Date().toISOString(),
      },
      trace_id: traceId,
    });
  }

  /**
   * Helper method to log an error event
   * 
   * @param paymentId The payment ID
   * @param eventType Type of error (VALIDATION_ERROR, ROUTING_ERROR, etc.)
   * @param error The error object or message
   * @param actor Who encountered the error
   * @param traceId Optional trace ID
   */
  async logError(
    paymentId: string,
    eventType: string,
    error: Error | string,
    actor: string,
    traceId?: string
  ): Promise<void> {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const errorStack = typeof error === 'string' ? undefined : error.stack;

    await this.insert({
      payment_id: paymentId,
      event_type: eventType,
      actor,
      detail: {
        error_message: errorMessage,
        error_stack: errorStack,
        timestamp: new Date().toISOString(),
      },
      trace_id: traceId,
    });
  }

  /**
   * Helper method to log an ACK received event
   * 
   * @param paymentId The payment ID
   * @param railAck The ACK response from the rail
   * @param actor The adapter or system that received it
   * @param traceId Optional trace ID
   */
  async logAckReceived(
    paymentId: string,
    railAck: unknown,
    actor: string,
    traceId?: string
  ): Promise<void> {
    const ackData = typeof railAck === 'object' ? railAck : JSON.parse(railAck as string);

    await this.insert({
      payment_id: paymentId,
      event_type: 'ACK_RECEIVED',
      actor,
      detail: {
        ack_response: ackData,
        timestamp: new Date().toISOString(),
      },
      trace_id: traceId,
    });
  }
}

