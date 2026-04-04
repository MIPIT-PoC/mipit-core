import { ulid } from 'ulid';
import type { CreatePaymentRequest } from '../api/schemas/payment-request.js';
import type { CanonicalPacs008 } from '../domain/models/canonical.js';
import { PAYMENT_STATUS } from '../config/constants.js';
import type { Translator } from '../translation/translator.js';
import type { Normalizer } from '../normalization/normalizer.js';
import type { RouteEngine } from '../routing/route-engine.js';
import type { Publisher } from '../messaging/publisher.js';
import type { PaymentRepository } from '../persistence/repositories/payment.repository.js';
import type { AuditService } from '../audit/audit-service.js';
import type { Logger } from 'pino';
import { startLatencyTimer } from '../observability/metrics.js';

export class PaymentPipeline {
  constructor(
    private readonly translator: Translator,
    private readonly normalizer: Normalizer,
    private readonly routeEngine: RouteEngine,
    private readonly publisher: Publisher,
    private readonly paymentRepo: PaymentRepository,
    private readonly auditService: AuditService,
    private readonly logger: Logger,
  ) {}

  async execute(
    request: CreatePaymentRequest,
    context: { idempotencyKey?: string; traceId?: string },
  ) {
    const stopTotal = startLatencyTimer('pipeline_total');
    const paymentId = `PMT-${ulid()}`;
    const traceId = context.traceId ?? ulid();
    const now = new Date().toISOString();
    const log = this.logger.child({ payment_id: paymentId, trace_id: traceId });

    const originRail = this.inferRail(request.debtor.alias);
    log.info({ origin_rail: originRail }, 'Step 1: Rail inferred from debtor alias');

    try {
      // Step 2: Persist with status RECEIVED
      await this.paymentRepo.create({
        payment_id: paymentId,
        idempotency_key: context.idempotencyKey,
        status: PAYMENT_STATUS.RECEIVED,
        origin_rail: originRail,
        amount: request.amount,
        currency: request.currency,
        debtor_alias: request.debtor.alias,
        debtor_name: request.debtor.name,
        creditor_alias: request.creditor.alias,
        creditor_name: request.creditor.name,
        purpose: request.purpose,
        reference: request.reference,
        origin_payload: request,
        trace_id: traceId,
        created_at: now,
      });
      await this.auditService.log(paymentId, 'PAYMENT_RECEIVED', 'system', {
        origin_rail: originRail,
        amount: request.amount,
        currency: request.currency,
      }, traceId);
      log.info('Step 2: Payment persisted with RECEIVED status');

      // Step 3: Validate -> VALIDATED
      await this.paymentRepo.updateStatus(paymentId, PAYMENT_STATUS.VALIDATED);
      await this.auditService.log(paymentId, 'PAYMENT_VALIDATED', 'system-validator', {
        origin_rail: originRail,
        debtor_alias: request.debtor.alias,
        creditor_alias: request.creditor.alias,
      }, traceId);
      log.info('Step 3: Payload validated');

      // Step 4: Translate to canonical (pacs.008) -> CANONICALIZED
      const stopTranslation = startLatencyTimer('pipeline_to_canonical');
      const canonical: CanonicalPacs008 = await this.translator.toCanonical(
        originRail,
        request,
        paymentId,
        traceId,
      );
      stopTranslation();
      await this.paymentRepo.updateCanonical(paymentId, canonical, PAYMENT_STATUS.CANONICALIZED);
      await this.auditService.log(paymentId, 'CANONICAL_UPDATED', 'system-translator', {
        pacs008_version: '008.001.08',
        fields_count: Object.keys(canonical).length,
      }, traceId);
      log.info('Step 4: Translated to canonical pacs.008');

      // Step 5: Normalize
      const stopNormalization = startLatencyTimer('pipeline_normalization');
      const normalized = await this.normalizer.normalize(canonical);
      stopNormalization();
      await this.auditService.log(paymentId, 'NORMALIZATION_COMPLETE', 'system', {
        currency: normalized.amount.currency,
        has_fx: !!normalized.fx?.target_currency,
      }, traceId);
      log.info({ currency: normalized.amount.currency }, 'Step 5: Normalization complete');

      // Step 6: Route -> ROUTED
      const stopRouting = startLatencyTimer('pipeline_routing');
      const route = await this.routeEngine.resolve(normalized);
      stopRouting();
      await this.paymentRepo.updateRoute(
        paymentId,
        route.destination,
        route.ruleName,
        PAYMENT_STATUS.ROUTED,
      );
      await this.auditService.logRoutingDecision(
        paymentId,
        route.destination,
        route.ruleName,
        'system-router',
        traceId,
      );
      log.info({ destination: route.destination, rule: route.ruleName }, 'Step 6: Routed');

      // Step 6b: Translate to destination format
      const stopFromCanonical = startLatencyTimer('pipeline_from_canonical');
      const translated = await this.translator.fromCanonical(route.destination, normalized);
      stopFromCanonical();
      await this.paymentRepo.updateTranslated(paymentId, translated);
      log.info({ destination: route.destination }, 'Step 6b: Translated to destination format');

      // Step 7: Publish to RabbitMQ -> QUEUED
      await this.publisher.publishToAdapter(route.destination, {
        payment_id: paymentId,
        trace_id: traceId,
        canonical: normalized,
        translated,
        destination_rail: route.destination,
        route_rule_applied: route.ruleName,
        routed_at: new Date().toISOString(),
      });
      await this.paymentRepo.updateStatus(paymentId, PAYMENT_STATUS.QUEUED);
      await this.auditService.log(paymentId, 'STATUS_CHANGE', 'system', {
        from_status: PAYMENT_STATUS.ROUTED,
        to_status: PAYMENT_STATUS.QUEUED,
      }, traceId);
      log.info('Step 7: Published to adapter queue with QUEUED status');

      stopTotal();
      log.info({ destination: route.destination }, 'Pipeline completed successfully');

      return {
        payment_id: paymentId,
        status: PAYMENT_STATUS.QUEUED,
        created_at: now,
        destination_rail: route.destination,
      };
    } catch (err) {
      stopTotal();

      try {
        await this.paymentRepo.updateStatus(paymentId, PAYMENT_STATUS.FAILED);
        await this.auditService.logError(
          paymentId,
          'PIPELINE_ERROR',
          err instanceof Error ? err : new Error(String(err)),
          'system-pipeline',
          traceId,
        );
      } catch (auditErr) {
        log.error({ err: auditErr }, 'Failed to record pipeline error in audit/DB');
      }

      log.error({ err }, 'Pipeline failed');
      throw err;
    }
  }

  private inferRail(alias: string): string {
    if (alias.startsWith('PIX-')) return 'PIX';
    if (alias.startsWith('SPEI-')) return 'SPEI';
    if (alias.startsWith('BREB-')) return 'BRE_B';
    throw new Error(`Cannot infer rail from alias: ${alias}`);
  }
}
