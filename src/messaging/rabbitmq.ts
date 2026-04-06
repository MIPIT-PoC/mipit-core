import amqplib from 'amqplib';
import type { ChannelModel, Channel } from 'amqplib';
import { EXCHANGES, QUEUES, ROUTING_KEYS } from '../config/constants.js';
import { logger } from '../observability/logger.js';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

export async function connectRabbitMQ(url: string): Promise<{ connection: ChannelModel; channel: Channel }> {
  connection = await amqplib.connect(url);
  channel = await connection.createChannel();

  // Main exchange
  await channel.assertExchange(EXCHANGES.PAYMENTS, 'topic', { durable: true });

  // Dead Letter Exchange (DLX)
  await channel.assertExchange(EXCHANGES.DLX, 'topic', { durable: true });

  // ACK queue
  await channel.assertQueue(QUEUES.ACK, { durable: true });
  await channel.bindQueue(QUEUES.ACK, EXCHANGES.PAYMENTS, ROUTING_KEYS.ACK_PIX);
  await channel.bindQueue(QUEUES.ACK, EXCHANGES.PAYMENTS, ROUTING_KEYS.ACK_SPEI);
  await channel.bindQueue(QUEUES.ACK, EXCHANGES.PAYMENTS, ROUTING_KEYS.ACK_BREB);

  // Dead Letter Queue (DLQ)
  await channel.assertQueue(QUEUES.DLQ, { durable: true });
  await channel.bindQueue(QUEUES.DLQ, EXCHANGES.DLX, ROUTING_KEYS.DLQ);

  logger.info('RabbitMQ connected — topology declared (payments + DLX + DLQ)');

  return { connection, channel };
}

export function getChannel(): Channel {
  if (!channel) throw new Error('RabbitMQ channel not initialized');
  return channel;
}
