/**
 * WebhookRepository — persistence for webhook_subscriptions table.
 * See: mipit-infra/db/migrations/004_webhooks.sql
 */

import type { Pool } from 'pg';

export interface WebhookSubscription {
  id: string;
  payment_id: string;
  url: string;
  events: string[];
  secret: string | null;
  created_at: string;
  fired_at: string | null;
  last_http_status: number | null;
  delivery_attempts: number;
  last_error: string | null;
}

export type CreateWebhookInput = {
  payment_id: string;
  url: string;
  events?: string[];
  secret?: string;
};

export class WebhookRepository {
  constructor(private readonly db: Pool) {}

  async create(input: CreateWebhookInput): Promise<WebhookSubscription> {
    const events = input.events ?? ['COMPLETED', 'FAILED', 'REJECTED'];
    const result = await this.db.query<WebhookSubscription>(
      `INSERT INTO webhook_subscriptions (payment_id, url, events, secret)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.payment_id, input.url, events, input.secret ?? null],
    );
    return result.rows[0]!;
  }

  async findByPaymentId(paymentId: string): Promise<WebhookSubscription[]> {
    const result = await this.db.query<WebhookSubscription>(
      `SELECT * FROM webhook_subscriptions WHERE payment_id = $1 ORDER BY created_at`,
      [paymentId],
    );
    return result.rows;
  }

  /** Fetch all unfired subscriptions for a given payment_id that subscribe to the given event */
  async findPending(paymentId: string, event: string): Promise<WebhookSubscription[]> {
    const result = await this.db.query<WebhookSubscription>(
      `SELECT * FROM webhook_subscriptions
       WHERE payment_id = $1 AND $2 = ANY(events)`,
      [paymentId, event],
    );
    return result.rows;
  }

  async recordDelivery(
    id: string,
    httpStatus: number,
    error: string | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE webhook_subscriptions
       SET fired_at = NOW(),
           last_http_status = $2,
           delivery_attempts = delivery_attempts + 1,
           last_error = $3
       WHERE id = $1`,
      [id, httpStatus, error],
    );
  }
}
