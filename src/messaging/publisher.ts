import type { Channel } from 'amqplib';
import { EXCHANGES, ROUTING_KEYS } from '../config/constants.js';
import { logger } from '../observability/logger.js';

export class Publisher {
  constructor(private readonly channel: Channel) {}

  async publishToAdapter(destinationRail: string, message: Record<string, unknown>): Promise<void> {
    const routingKey =
      destinationRail === 'PIX' ? ROUTING_KEYS.ROUTE_PIX : ROUTING_KEYS.ROUTE_SPEI;

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

    logger.info(
      { routing_key: routingKey, payment_id: message.payment_id },
      'Message published to adapter',
    );
  }
}
