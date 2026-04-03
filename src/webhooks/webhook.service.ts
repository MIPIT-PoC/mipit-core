/**
 * WebhookService — delivers signed HTTP POST notifications on terminal payment status.
 *
 * Triggered when a payment reaches COMPLETED, FAILED, or REJECTED.
 * Signs the payload with HMAC-SHA256 using:
 *   1. Per-subscription secret (if set), or
 *   2. Global WEBHOOK_SECRET env var (if set), or
 *   3. No signature header (signature omitted)
 *
 * Signature header: X-MIPIT-Signature: sha256=<hex>
 * Payload (POST body): { payment_id, status, event, timestamp, payment }
 *
 * Retry: one immediate attempt. Failed deliveries are logged and recorded
 * (last_error, last_http_status). No background retry queue for PoC.
 */

import crypto from 'node:crypto';
import { logger } from '../observability/logger.js';
import type { WebhookRepository } from './webhook.repository.js';
import type { PaymentIntent } from '../domain/models/payment.js';

export const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'REJECTED']);

export class WebhookService {
  constructor(
    private readonly webhookRepo: WebhookRepository,
    private readonly globalSecret: string | undefined,
  ) {}

  /**
   * Fire all subscriptions for a payment when it enters a terminal status.
   * Called from AckConsumer / pipeline after status update.
   */
  async fireForPayment(payment: PaymentIntent): Promise<void> {
    if (!TERMINAL_STATUSES.has(payment.status)) return;

    const subs = await this.webhookRepo.findPending(payment.payment_id, payment.status);
    if (subs.length === 0) return;

    await Promise.allSettled(
      subs.map((sub) => this.deliver(sub.id, sub.url, sub.secret, payment)),
    );
  }

  private async deliver(
    subId: string,
    url: string,
    subSecret: string | null,
    payment: PaymentIntent,
  ): Promise<void> {
    const payload = {
      payment_id: payment.payment_id,
      status: payment.status,
      event: payment.status,
      timestamp: new Date().toISOString(),
      payment: {
        origin_rail: payment.origin_rail,
        destination_rail: payment.destination_rail ?? null,
        amount: payment.amount,
        currency: payment.currency,
        debtor_alias: payment.debtor_alias,
        creditor_alias: payment.creditor_alias,
        created_at: payment.created_at,
        completed_at: payment.completed_at ?? null,
      },
    };

    const body = JSON.stringify(payload);
    const secret = subSecret ?? this.globalSecret;
    const signature = secret ? this.sign(body, secret) : null;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'MIPIT-Webhook/1.0',
    };
    if (signature) {
      headers['X-MIPIT-Signature'] = `sha256=${signature}`;
    }

    let httpStatus = 0;
    let error: string | null = null;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10_000), // 10s timeout
      });
      httpStatus = res.status;

      if (!res.ok) {
        error = `HTTP ${res.status}: ${res.statusText}`;
        logger.warn({ subId, url, httpStatus, payment_id: payment.payment_id }, 'Webhook delivery failed (non-2xx)');
      } else {
        logger.info({ subId, url, httpStatus, payment_id: payment.payment_id }, 'Webhook delivered successfully');
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      httpStatus = 0;
      logger.warn({ subId, url, err, payment_id: payment.payment_id }, 'Webhook delivery error (network/timeout)');
    }

    await this.webhookRepo.recordDelivery(subId, httpStatus, error);
  }

  /** HMAC-SHA256 of body using the given secret, returns hex string */
  private sign(body: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  }

  /**
   * Utility: verify an incoming webhook signature.
   * Call this in the client that receives the webhook.
   * Returns true if the signature is valid.
   */
  static verifySignature(body: string, secret: string, headerValue: string): boolean {
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(headerValue));
    } catch {
      return false;
    }
  }
}
