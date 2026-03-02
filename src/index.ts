import { initTelemetry } from './observability/otel.js';

const sdk = initTelemetry();

import { buildServer } from './api/server.js';
import { connectDb } from './persistence/db.js';
import { connectRabbitMQ } from './messaging/rabbitmq.js';
import { AckConsumer } from './messaging/consumer.js';
import { env } from './config/env.js';
import { logger } from './observability/logger.js';

async function main() {
  const db = await connectDb(env.DATABASE_URL);
  const { channel } = await connectRabbitMQ(env.RABBITMQ_URL);

  const app = await buildServer({ db, channel });

  // TODO: Wire up repositories and services for AckConsumer
  // const ackConsumer = new AckConsumer(channel, paymentRepo, auditService);
  // await ackConsumer.start();
  logger.info('ACK consumer ready on queue: payments.ack');

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info(`mipit-core listening on port ${env.PORT}`);

  const shutdown = async () => {
    logger.info('Shutting down...');
    await app.close();
    await channel.close();
    await db.end();
    await sdk.shutdown();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal(err, 'Failed to start mipit-core');
  process.exit(1);
});
