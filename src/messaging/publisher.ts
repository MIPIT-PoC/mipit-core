import type { Channel, ConfirmChannel } from 'amqplib';
import { EXCHANGES, ROUTING_KEYS } from '../config/constants.js';
import { logger } from '../observability/logger.js';

/**
 * P06 — Publisher that uses RabbitMQ publisher confirms when given a
 * ConfirmChannel. Falls back to plain Channel for backward compatibility,
 * but logs a warning because messages can be silently lost.
 *
 * Best practice: wire a ConfirmChannel from index.ts via
 * `connection.createConfirmChannel()`. With confirms, `await publish()`
 * actually waits for the broker to ack the publish, eliminating the
 * window where `persistent: true` is theatre because the channel never
 * flushed the message before crash.
 */
export class Publisher {
  private readonly isConfirm: boolean;

  constructor(private readonly channel: Channel | ConfirmChannel) {
    // Heuristic: ConfirmChannel has `waitForConfirms` method
    this.isConfirm = typeof (channel as ConfirmChannel).waitForConfirms === 'function';
    if (!this.isConfirm) {
      logger.warn('Publisher running WITHOUT confirms — messages may be silently lost on broker blip. Wire a ConfirmChannel.');
    }
  }

  async publishToAdapter(destinationRail: string, message: Record<string, unknown>): Promise<void> {
    const railKeyMap: Record<string, string> = {
      PIX: ROUTING_KEYS.ROUTE_PIX,
      SPEI: ROUTING_KEYS.ROUTE_SPEI,
      BRE_B: ROUTING_KEYS.ROUTE_BREB,
    };
    const routingKey = railKeyMap[destinationRail];
    if (!routingKey) {
      throw new Error(`No routing key configured for rail: ${destinationRail}`);
    }

    if (this.isConfirm) {
      // Publisher confirms — return a Promise that resolves on broker ack.
      await new Promise<void>((resolve, reject) => {
        (this.channel as ConfirmChannel).publish(
          EXCHANGES.PAYMENTS,
          routingKey,
          Buffer.from(JSON.stringify(message)),
          {
            persistent: true,
            mandatory: true, // route to alternate-exchange on unrouted (P09)
            contentType: 'application/json',
            timestamp: Date.now(),
          },
          (err) => {
            if (err) {
              logger.error({ err, routing_key: routingKey, payment_id: message.payment_id }, 'Publish confirm NACK');
              reject(err);
            } else {
              resolve();
            }
          },
        );
      });
    } else {
      // Legacy path: synchronous publish without confirms.
      this.channel.publish(
        EXCHANGES.PAYMENTS,
        routingKey,
        Buffer.from(JSON.stringify(message)),
        {
          persistent: true,
          contentType: 'application/json',
          timestamp: Date.now(),
        },
      );
    }

    logger.info(
      { routing_key: routingKey, payment_id: message.payment_id, confirmed: this.isConfirm },
      'Message published to adapter',
    );
  }
}
