import type { AuditRepository } from '../persistence/repositories/audit.repository.js';
import { logger } from '../observability/logger.js';

export class AuditService {
  constructor(private readonly repo: AuditRepository) {}

  /**
   * Log a generic audit event
   * 
   * @param paymentId The payment ID
   * @param eventType The type of event
   * @param actor The actor who caused the event
   * @param detail Event details as object
   * @param traceId Optional trace ID for correlation
   */
  async log(
    paymentId: string,
    eventType: string,
    actor: string,
    detail: Record<string, unknown>,
    traceId?: string,
  ): Promise<void> {
    await this.repo.insert({
      payment_id: paymentId,
      event_type: eventType,
      actor,
      detail,
      trace_id: traceId,
    });

    logger.debug(
      { payment_id: paymentId, event_type: eventType, actor },
      'Audit event recorded',
    );
  }

  /**
   * Log a status change event
   * 
   * @param paymentId The payment ID
   * @param fromStatus Previous status
   * @param toStatus New status
   * @param actor The actor making the change
   * @param traceId Optional trace ID
   */
  async logStatusChange(
    paymentId: string,
    fromStatus: string,
    toStatus: string,
    actor: string,
    traceId?: string,
  ): Promise<void> {
    await this.repo.logStatusChange(paymentId, fromStatus, toStatus, actor, traceId);

    logger.debug(
      {
        payment_id: paymentId,
        from_status: fromStatus,
        to_status: toStatus,
        actor,
      },
      'Status change recorded',
    );
  }

  /**
   * Log a routing decision event
   * 
   * @param paymentId The payment ID
   * @param destinationRail The selected rail
   * @param ruleName The routing rule
   * @param actor The routing system
   * @param traceId Optional trace ID
   */
  async logRoutingDecision(
    paymentId: string,
    destinationRail: string,
    ruleName: string,
    actor: string,
    traceId?: string,
  ): Promise<void> {
    await this.repo.logRoutingDecision(
      paymentId,
      destinationRail,
      ruleName,
      actor,
      traceId,
    );

    logger.debug(
      {
        payment_id: paymentId,
        destination_rail: destinationRail,
        rule_name: ruleName,
      },
      'Routing decision recorded',
    );
  }

  /**
   * Log an error event
   * 
   * @param paymentId The payment ID
   * @param eventType The error event type
   * @param error The error object or message
   * @param actor The system/actor that encountered the error
   * @param traceId Optional trace ID
   */
  async logError(
    paymentId: string,
    eventType: string,
    error: Error | string,
    actor: string,
    traceId?: string,
  ): Promise<void> {
    await this.repo.logError(paymentId, eventType, error, actor, traceId);

    const errorMessage = typeof error === 'string' ? error : error.message;

    logger.warn(
      {
        payment_id: paymentId,
        event_type: eventType,
        error_message: errorMessage,
        actor,
      },
      'Error event recorded',
    );
  }

  /**
   * Log an ACK received event
   * 
   * @param paymentId The payment ID
   * @param railAck The ACK response from the rail
   * @param actor The adapter that received the ACK
   * @param traceId Optional trace ID
   */
  async logAckReceived(
    paymentId: string,
    railAck: unknown,
    actor: string,
    traceId?: string,
  ): Promise<void> {
    await this.repo.logAckReceived(paymentId, railAck, actor, traceId);

    logger.debug(
      {
        payment_id: paymentId,
        actor,
        ack_received: true,
      },
      'ACK event recorded',
    );
  }
}

