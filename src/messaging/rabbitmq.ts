import amqplib from 'amqplib';
import type { Connection, Channel } from 'amqplib';
import { EXCHANGES, QUEUES, ROUTING_KEYS } from '../config/constants.js';
import { logger } from '../observability/logger.js';

let connection: Connection | null = null;
let channel: Channel | null = null;

export async function connectRabbitMQ(url: string): Promise<{ connection: Connection; channel: Channel }> {
  connection = await amqplib.connect(url);
  channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGES.PAYMENTS, 'topic', { durable: true });

  await channel.assertQueue(QUEUES.ACK, { durable: true });
  await channel.bindQueue(QUEUES.ACK, EXCHANGES.PAYMENTS, ROUTING_KEYS.ACK_PIX);
  await channel.bindQueue(QUEUES.ACK, EXCHANGES.PAYMENTS, ROUTING_KEYS.ACK_SPEI);

  logger.info('RabbitMQ connected and topology declared');

  return { connection, channel };
}

export function getChannel(): Channel {
  if (!channel) throw new Error('RabbitMQ channel not initialized');
  return channel;
}
