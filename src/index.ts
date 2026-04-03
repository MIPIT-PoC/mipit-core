import { initTelemetry } from './observability/otel.js';

const sdk = initTelemetry();

import { buildServer } from './api/server.js';
import { connectDb } from './persistence/db.js';
import { connectRabbitMQ } from './messaging/rabbitmq.js';
import { env } from './config/env.js';
import { logger } from './observability/logger.js';

import { PaymentRepository } from './persistence/repositories/payment.repository.js';
import { AuditRepository } from './persistence/repositories/audit.repository.js';
import { IdempotencyRepository } from './persistence/repositories/idempotency.repository.js';
import { MappingRepository } from './persistence/repositories/mapping.repository.js';
import { RouteRuleRepository } from './persistence/repositories/route-rule.repository.js';
import { AuditService } from './audit/audit-service.js';
import { MappingLoader } from './translation/mapping-loader.js';
import { Translator } from './translation/translator.js';
import { Normalizer } from './normalization/normalizer.js';
import { RuleLoader } from './routing/rule-loader.js';
import { RouteEngine } from './routing/route-engine.js';
import { Publisher } from './messaging/publisher.js';
import { PaymentPipeline } from './pipeline/payment-pipeline.js';
import { AckConsumer } from './messaging/consumer.js';

async function main() {
  const db = await connectDb(env.DATABASE_URL);
  const { connection, channel } = await connectRabbitMQ(env.RABBITMQ_URL);

  const paymentRepo = new PaymentRepository(db);
  const auditRepo = new AuditRepository(db);
  const idempotencyRepo = new IdempotencyRepository(db);
  const mappingRepo = new MappingRepository(db);
  const routeRuleRepo = new RouteRuleRepository(db);

  const auditService = new AuditService(auditRepo);
  const mappingLoader = new MappingLoader(mappingRepo);
  const translator = new Translator(mappingLoader);
  const normalizer = new Normalizer();
  const ruleLoader = new RuleLoader(routeRuleRepo);
  const routeEngine = new RouteEngine(ruleLoader);
  const publisher = new Publisher(channel);

  const pipeline = new PaymentPipeline(
    translator,
    normalizer,
    routeEngine,
    publisher,
    paymentRepo,
    auditService,
    logger,
  );

  const app = await buildServer({
    db,
    channel,
    jwtSecret: env.JWT_SECRET,
    pipeline,
    paymentRepo,
    auditRepo,
    idempotencyRepo,
    auditService,
    translator,
    mappingLoader,
  });

  const ackConsumer = new AckConsumer(channel, paymentRepo, auditService);
  await ackConsumer.start();
  logger.info('AckConsumer started and listening for ACK messages');

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info(`mipit-core listening on port ${env.PORT}`);

  const shutdown = async () => {
    logger.info('Shutting down gracefully...');
    await app.close();
    await channel.close();
    await connection.close();
    await db.end();
    await sdk.shutdown();
    logger.info('All resources closed. Exiting.');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal(err, 'Failed to start mipit-core');
  process.exit(1);
});
