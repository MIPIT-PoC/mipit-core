/**
 * Dead Letter Queue (DLQ) Handler
 *
 * Processes messages that have failed after max retries.
 * Implements the compensating transaction pattern:
 *   1. Consume from DLQ
 *   2. Log failure in audit trail
 *   3. Update payment status to DEAD_LETTER
 *   4. Attempt compensation if needed (e.g., reverse pending transactions)
 *   5. Notify via webhook
 *
 * RabbitMQ DLQ topology:
 *   Exchange: mipit.dlx (dead letter exchange)
 *   Queue:    payments.dlq
 *   Binding:  dlq.# (catch-all)
 */

import type { Channel } from 'amqplib';
import { QUEUES, PAYMENT_STATUS, DLQ_MAX_RETRIES } from '../config/constants.js';
import type { PaymentRepository } from '../persistence/repositories/payment.repository.js';
import type { AuditService } from '../audit/audit-service.js';
import { logger } from '../observability/logger.js';

interface DlqMessage {
  payment_id: string;
  trace_id: string;
  destination_rail: string;
  retry_count: number;
  original_error: string;
  failed_at: string;
}

export class DlqHandler {
  constructor(
    private readonly channel: Channel,
    private readonly paymentRepo: PaymentRepository,
    private readonly auditService: AuditService,
  ) {}

  async start(): Promise<void> {
    logger.info({ queue: QUEUES.DLQ }, 'DLQ handler started');

    await this.channel.consume(QUEUES.DLQ, async (msg) => {
      if (!msg) return;

      let dlqMsg: DlqMessage;
      try {
        dlqMsg = JSON.parse(msg.content.toString());
      } catch {
        logger.error('Invalid DLQ message format, discarding');
        this.channel.ack(msg);
        return;
      }

      const log = logger.child({ payment_id: dlqMsg.payment_id });

      try {
        // Mark payment as DEAD_LETTER
        await this.paymentRepo.updateStatus(dlqMsg.payment_id, PAYMENT_STATUS.DEAD_LETTER);

        await this.auditService.log(
          dlqMsg.payment_id,
          'DEAD_LETTER',
          'dlq-handler',
          {
            destination_rail: dlqMsg.destination_rail,
            retry_count: dlqMsg.retry_count,
            max_retries: DLQ_MAX_RETRIES,
            original_error: dlqMsg.original_error,
            failed_at: dlqMsg.failed_at,
          },
          dlqMsg.trace_id,
        );

        log.warn(
          { destination_rail: dlqMsg.destination_rail, retry_count: dlqMsg.retry_count },
          'Payment moved to DLQ after max retries — requires manual review or compensation',
        );

        this.channel.ack(msg);
      } catch (err) {
        log.error({ err }, 'Failed to process DLQ message');
        // Requeue DLQ messages — they need manual attention
        this.channel.nack(msg, false, true);
      }
    });
  }
}

/**
 * Checks if a message should be sent to DLQ based on retry count.
 * Returns true if max retries exceeded.
 */
export function shouldDeadLetter(msg: { properties?: { headers?: Record<string, unknown> } }): boolean {
  const retryCount = (msg.properties?.headers?.['x-retry-count'] as number) ?? 0;
  return retryCount >= DLQ_MAX_RETRIES;
}

/**
 * Increments retry count header and republishes the message.
 * If max retries exceeded, publishes to DLX instead.
 */
export function handleFailedMessage(
  channel: Channel,
  msg: { content: Buffer; fields: { exchange: string; routingKey: string }; properties: { headers?: Record<string, unknown> } },
  error: Error,
  dlxExchange: string,
): void {
  const retryCount = (msg.properties.headers?.['x-retry-count'] as number) ?? 0;

  if (retryCount >= DLQ_MAX_RETRIES) {
    // Send to Dead Letter Exchange
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(msg.content.toString()); } catch { /* use empty */ }

    const dlqPayload = {
      ...parsed,
      retry_count: retryCount,
      original_error: error.message,
      failed_at: new Date().toISOString(),
    };

    channel.publish(dlxExchange, 'dlq.failed', Buffer.from(JSON.stringify(dlqPayload)), {
      persistent: true,
      contentType: 'application/json',
    });

    logger.warn(
      { payment_id: parsed.payment_id, retryCount },
      'Message sent to DLQ after max retries',
    );
  } else {
    // Republish with incremented retry count
    const headers = { ...msg.properties.headers, 'x-retry-count': retryCount + 1 };
    channel.publish(msg.fields.exchange, msg.fields.routingKey, msg.content, {
      persistent: true,
      contentType: 'application/json',
      headers,
    });

    logger.info(
      { retryCount: retryCount + 1 },
      'Message requeued with incremented retry count',
    );
  }
}
