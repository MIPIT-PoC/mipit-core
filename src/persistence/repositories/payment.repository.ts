import { ulid } from 'ulid';
import type { Pool } from 'pg';
import type { PaymentIntent } from '../../domain/models/payment.js';
import type { CanonicalPacs008 } from '../../domain/models/canonical.js';
import { SQL } from '../queries/index.js';

export class PaymentRepository {
  constructor(private readonly db: Pool) {}

  /**
   * Generate a ULID for payment identification
   * @returns A new ULID string
   */
  private generatePaymentId(): string {
    return ulid();
  }

  /**
   * Create a new payment record with ULID-based payment_id
   * @param payment Partial payment intent data
   * @returns Complete PaymentIntent with auto-generated payment_id
   */
  async create(payment: Partial<PaymentIntent>): Promise<PaymentIntent> {
    // Generate ULID if payment_id not provided
    const payment_id = payment.payment_id || this.generatePaymentId();
    
    // Ensure created_at is set
    const created_at = payment.created_at || new Date().toISOString();

    const result = await this.db.query(SQL.INSERT_PAYMENT, [
      payment_id,
      payment.idempotency_key,
      payment.status || 'RECEIVED',
      payment.origin_rail,
      payment.amount,
      payment.currency,
      payment.debtor_alias,
      payment.debtor_name,
      payment.creditor_alias,
      payment.creditor_name,
      payment.purpose,
      payment.reference,
      payment.origin_payload ? JSON.stringify(payment.origin_payload) : null,
      payment.trace_id,
      created_at,
    ]);

    if (!result.rows[0]) {
      throw new Error(`Failed to create payment with id: ${payment_id}`);
    }

    return result.rows[0] as PaymentIntent;
  }

  /**
   * Find a payment by ID
   * @param paymentId The payment ID to search for
   * @returns PaymentIntent if found, null otherwise
   */
  async findById(paymentId: string): Promise<PaymentIntent | null> {
    if (!paymentId || paymentId.trim() === '') {
      throw new Error('Payment ID cannot be empty');
    }

    const result = await this.db.query(SQL.FIND_PAYMENT_BY_ID, [paymentId]);
    return (result.rows[0] as PaymentIntent) ?? null;
  }

  /**
   * Update payment status with automatic timestamp management
   * Sets timestamps automatically based on status transition:
   * - VALIDATED → validated_at
   * - QUEUED → queued_at
   * - SENT_TO_DESTINATION → sent_at
   * - COMPLETED → completed_at
   * - FAILED → failed_at
   * @param paymentId The payment ID
   * @param status The new status
   * @returns Updated PaymentIntent
   */
  async updateStatus(paymentId: string, status: string): Promise<PaymentIntent> {
    if (!paymentId || paymentId.trim() === '') {
      throw new Error('Payment ID cannot be empty');
    }
    if (!status || status.trim() === '') {
      throw new Error('Status cannot be empty');
    }

    const result = await this.db.query(SQL.UPDATE_PAYMENT_STATUS_WITH_MILESTONE_TIMESTAMPS, [status, paymentId]);

    if (!result.rows[0]) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    return result.rows[0] as PaymentIntent;
  }

  /**
   * Update payment with canonicalized PACS008 payload
   * Sets canonical_payload and canonicalized_at timestamp
   * @param paymentId The payment ID
   * @param canonical The canonical PACS008 object
   * @param status The new status (typically 'CANONICALIZED')
   * @returns Updated PaymentIntent
   */
  async updateCanonical(paymentId: string, canonical: CanonicalPacs008, status: string): Promise<PaymentIntent> {
    if (!paymentId || paymentId.trim() === '') {
      throw new Error('Payment ID cannot be empty');
    }
    if (!canonical) {
      throw new Error('Canonical payload cannot be empty');
    }

    const result = await this.db.query(SQL.UPDATE_PAYMENT_CANONICAL_PAYLOAD, [JSON.stringify(canonical), status, paymentId]);

    if (!result.rows[0]) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    return result.rows[0] as PaymentIntent;
  }

  /**
   * Update payment with routing decision
   * Sets destination_rail, route_rule_applied, and routed_at timestamp
   * @param paymentId The payment ID
   * @param destinationRail The target rail (PIX, SPEI, etc.)
   * @param ruleName The name of the rule that matched
   * @param status The new status (typically 'ROUTED')
   * @returns Updated PaymentIntent
   */
  async updateRoute(paymentId: string, destinationRail: string, ruleName: string, status: string): Promise<PaymentIntent> {
    if (!paymentId || paymentId.trim() === '') {
      throw new Error('Payment ID cannot be empty');
    }
    if (!destinationRail || destinationRail.trim() === '') {
      throw new Error('Destination rail cannot be empty');
    }
    if (!ruleName || ruleName.trim() === '') {
      throw new Error('Rule name cannot be empty');
    }

    const result = await this.db.query(SQL.UPDATE_PAYMENT_ROUTE, [destinationRail, ruleName, status, paymentId]);

    if (!result.rows[0]) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    return result.rows[0] as PaymentIntent;
  }

  /**
   * Update payment with destination rail-specific translation
   * Stores the translated payload for the destination rail
   * @param paymentId The payment ID
   * @param translated The translated payload (PACS002, PIX format, etc.)
   * @returns Updated PaymentIntent
   */
  async updateTranslated(paymentId: string, translated: unknown): Promise<PaymentIntent> {
    if (!paymentId || paymentId.trim() === '') {
      throw new Error('Payment ID cannot be empty');
    }
    if (!translated) {
      throw new Error('Translated payload cannot be empty');
    }

    const result = await this.db.query(SQL.UPDATE_PAYMENT_TRANSLATED_PAYLOAD, [JSON.stringify(translated), paymentId]);

    if (!result.rows[0]) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    return result.rows[0] as PaymentIntent;
  }

  /**
   * Update payment with rail acknowledgment (ACK) response
   * Stores the complete ACK as JSONB and updates status
   * @param paymentId The payment ID
   * @param railAck The ACK response from the rail (as object or JSON)
   * @param status The new status (typically 'ACKED_BY_RAIL' or 'COMPLETED')
   * @returns Updated PaymentIntent
   */
  async updateRailAck(paymentId: string, railAck: unknown, status: string = 'ACKED_BY_RAIL'): Promise<PaymentIntent> {
    if (!paymentId || paymentId.trim() === '') {
      throw new Error('Payment ID cannot be empty');
    }
    if (!railAck) {
      throw new Error('Rail ACK response cannot be empty');
    }
    if (!status || status.trim() === '') {
      throw new Error('Status cannot be empty');
    }

    // Ensure railAck is properly formatted as JSON
    const railAckJson = typeof railAck === 'string' ? railAck : JSON.stringify(railAck);

    const result = await this.db.query(SQL.UPDATE_RAIL_ACK, [railAckJson, status, paymentId]);

    if (!result.rows[0]) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    return result.rows[0] as PaymentIntent;
  }

  /**
   * Update ACK (alias for updateRailAck for backward compatibility)
   * @deprecated Use updateRailAck() instead
   */
  async updateAck(paymentId: string, railAck: unknown, status: string): Promise<void> {
    await this.updateRailAck(paymentId, railAck, status);
  }
}
