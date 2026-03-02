import type { Pool } from 'pg';
import type { PaymentIntent } from '../../domain/models/payment.js';
import type { CanonicalPacs008 } from '../../domain/models/canonical.js';
import { SQL } from '../queries/index.js';

export class PaymentRepository {
  constructor(private readonly db: Pool) {}

  async create(payment: Partial<PaymentIntent>): Promise<PaymentIntent> {
    const result = await this.db.query(SQL.INSERT_PAYMENT, [
      payment.payment_id,
      payment.idempotency_key,
      payment.status,
      payment.origin_rail,
      payment.amount,
      payment.currency,
      payment.debtor_alias,
      payment.debtor_name,
      payment.creditor_alias,
      payment.creditor_name,
      payment.purpose,
      payment.reference,
      JSON.stringify(payment.origin_payload),
      payment.trace_id,
      payment.created_at,
    ]);
    return result.rows[0] as PaymentIntent;
  }

  async findById(paymentId: string): Promise<PaymentIntent | null> {
    const result = await this.db.query(SQL.FIND_PAYMENT_BY_ID, [paymentId]);
    return (result.rows[0] as PaymentIntent) ?? null;
  }

  async updateStatus(paymentId: string, status: string): Promise<void> {
    await this.db.query(SQL.UPDATE_PAYMENT_STATUS, [status, paymentId]);
  }

  async updateCanonical(paymentId: string, canonical: CanonicalPacs008, status: string): Promise<void> {
    await this.db.query(SQL.UPDATE_CANONICAL, [JSON.stringify(canonical), status, paymentId]);
  }

  async updateRoute(paymentId: string, destinationRail: string, ruleName: string, status: string): Promise<void> {
    await this.db.query(SQL.UPDATE_ROUTE, [destinationRail, ruleName, status, paymentId]);
  }

  async updateTranslated(paymentId: string, translated: unknown): Promise<void> {
    await this.db.query(SQL.UPDATE_TRANSLATED, [JSON.stringify(translated), paymentId]);
  }

  async updateAck(paymentId: string, railAck: unknown, status: string): Promise<void> {
    await this.db.query(SQL.UPDATE_ACK, [JSON.stringify(railAck), status, paymentId]);
  }
}
