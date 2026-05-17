import { initTelemetry } from './observability/otel.js';

const sdk = initTelemetry();

import { buildServer } from './api/server.js';
import { setHealthDeps } from './api/routes/health.js';
import { connectDb } from './persistence/db.js';
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
import { DlqHandler } from './messaging/dlq-handler.js';
import { WebhookRepository } from './webhooks/webhook.repository.js';
import { WebhookService } from './webhooks/webhook.service.js';
import { FxService } from './fx/fx-service.js';
import { CompensationService } from './compensation/compensation-service.js';
import { ReconciliationService } from './reconciliation/reconciliation-service.js';
import { RateLimiter } from './resilience/rate-limiter.js';
import { RabbitMQReconnector } from './resilience/reconnect.js';
import { EXCHANGES, QUEUES, ROUTING_KEYS } from './config/constants.js';

async function main() {
  const db = await connectDb(env.DATABASE_URL);

  // RabbitMQ with auto-reconnect
  const reconnector = new RabbitMQReconnector(env.RABBITMQ_URL, {
    baseMs: 1000,
    maxMs: 30_000,
    onReconnect: async (_conn, ch) => {
      await setupRabbitMQTopology(ch);
      logger.info('RabbitMQ topology re-established after reconnect');
    },
    onGiveUp: (err) => {
      logger.fatal({ err }, 'RabbitMQ permanently lost — shutting down');
      process.exit(1);
    },
  });

  const { connection, channel } = await reconnector.connect();
  await setupRabbitMQTopology(channel);

  const paymentRepo = new PaymentRepository(db);
  const auditRepo = new AuditRepository(db);
  const idempotencyRepo = new IdempotencyRepository(db);

  // P06 — Background sweeper: purge expired idempotency claims every hour.
  // Uses the sweep_expired_idempotency_keys() SQL function from migration 011.
  const sweepInterval = setInterval(async () => {
    try {
      const r = await db.query('SELECT sweep_expired_idempotency_keys() AS deleted');
      const deleted = (r.rows[0] as { deleted: number }).deleted;
      if (deleted > 0) {
        logger.info({ deleted }, 'Idempotency sweeper purged expired claims');
      }
    } catch (err) {
      logger.warn({ err }, 'Idempotency sweeper failed (non-fatal)');
    }
  }, 60 * 60 * 1000);
  if (typeof sweepInterval.unref === 'function') sweepInterval.unref();
  const mappingRepo = new MappingRepository(db);
  const routeRuleRepo = new RouteRuleRepository(db);
  const webhookRepo = new WebhookRepository(db);
  const webhookService = new WebhookService(webhookRepo, env.WEBHOOK_SECRET);

  const auditService = new AuditService(auditRepo);
  const mappingLoader = new MappingLoader(mappingRepo);
  const translator = new Translator(mappingLoader);
  const fxService = new FxService(env.OPEN_EXCHANGE_RATES_APP_ID);
  const normalizer = new Normalizer(fxService);
  const ruleLoader = new RuleLoader(routeRuleRepo);
  const routeEngine = new RouteEngine(ruleLoader);
  // P06 — channel is a ConfirmChannel (see reconnect.useConfirmChannel default).
  const publisher = new Publisher(channel as any);
  const rateLimiter = new RateLimiter();

  const compensationService = new CompensationService(paymentRepo, auditService);
  const reconciliationService = new ReconciliationService(paymentRepo, auditService);

  const pipeline = new PaymentPipeline(
    translator,
    normalizer,
    routeEngine,
    publisher,
    paymentRepo,
    auditService,
    logger,
    rateLimiter, // P06 — wire the rate limiter (was dead code)
  );

  // P08: provide DB + channel to /health endpoint for deep probe
  setHealthDeps({ db, channel });

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
    webhookRepo,
    compensationService,
    reconciliationService,
    rateLimiter,
  });

  // P06 — Register consumer bootstraps with the reconnector so they re-attach
  // on every reconnect. Otherwise consumers stay bound to a dead channel and
  // ACKs accumulate invisibly post-blip.
  reconnector.registerConsumerBootstrap(async (ch) => {
    const consumer = new AckConsumer(ch, paymentRepo, auditService, webhookService);
    await consumer.start();
  });
  reconnector.registerConsumerBootstrap(async (ch) => {
    const dlq = new DlqHandler(ch, paymentRepo, auditService);
    await dlq.start();
  });

  // Start consumers on the initial channel (the bootstraps will fire again
  // automatically on reconnect via reconnector.scheduleReconnect).
  const ackConsumer = new AckConsumer(channel, paymentRepo, auditService, webhookService);
  await ackConsumer.start();
  logger.info('AckConsumer started and listening for ACK messages');

  const dlqHandler = new DlqHandler(channel, paymentRepo, auditService);
  await dlqHandler.start();
  logger.info('DLQ handler started — processing dead-lettered payments');

  // Start periodic reconciliation (every 30 minutes)
  const reconInterval = setInterval(async () => {
    try {
      const report = await reconciliationService.runReconciliation({ windowHours: 1, stuckThresholdMinutes: 15 });
      if (report.stuck_payments.length > 0 || report.anomalies.length > 0) {
        logger.warn({ stuck: report.stuck_payments.length, anomalies: report.anomalies.length }, 'Reconciliation found issues');
      }
    } catch (err) {
      logger.error({ err }, 'Periodic reconciliation failed');
    }
  }, 30 * 60_000);

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info(`mipit-core listening on port ${env.PORT}`);

  const shutdown = async () => {
    logger.info('Shutting down gracefully...');
    clearInterval(reconInterval);
    clearInterval(sweepInterval);
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

async function setupRabbitMQTopology(channel: import('amqplib').Channel) {
  await channel.assertExchange(EXCHANGES.PAYMENTS, 'topic', { durable: true });
  await channel.assertExchange(EXCHANGES.DLX, 'topic', { durable: true });
  await channel.assertQueue(QUEUES.ACK, { durable: true });
  await channel.bindQueue(QUEUES.ACK, EXCHANGES.PAYMENTS, ROUTING_KEYS.ACK_PIX);
  await channel.bindQueue(QUEUES.ACK, EXCHANGES.PAYMENTS, ROUTING_KEYS.ACK_SPEI);
  await channel.bindQueue(QUEUES.ACK, EXCHANGES.PAYMENTS, ROUTING_KEYS.ACK_BREB);
  await channel.assertQueue(QUEUES.DLQ, { durable: true });
  await channel.bindQueue(QUEUES.DLQ, EXCHANGES.DLX, ROUTING_KEYS.DLQ);
}

main().catch((err) => {
  logger.fatal(err, 'Failed to start mipit-core');
  process.exit(1);
});
