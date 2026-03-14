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

/**
 * Orchestrates the full payment flow:
 * 1. Generate payment_id
 * 2. Persist with status RECEIVED
 * 3. Validate payload -> VALIDATED
 * 4. Translate to canonical (pacs.008) -> CANONICALIZED
 * 5. Normalize -> (stays CANONICALIZED)
 * 6. Route -> ROUTED
 * 7. Publish to RabbitMQ -> QUEUED
 */
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
    const paymentId = `PMT-${ulid()}`;
    const traceId = context.traceId ?? ulid();
    const now = new Date().toISOString();

    const originRail = this.inferRail(request.debtor.alias);

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

    const canonical: CanonicalPacs008 = await this.translator.toCanonical(
      originRail,
      request,
      paymentId,
      traceId,
    );
    await this.paymentRepo.updateCanonical(paymentId, canonical, PAYMENT_STATUS.CANONICALIZED);
    await this.auditService.log(paymentId, 'CANONICAL_UPDATED', 'system-translator', {
      pacs008_version: '008.001.08',
      fields_normalized: Object.keys(canonical).length,
    }, traceId);

    const normalized = await this.normalizer.normalize(canonical);
    await this.auditService.log(paymentId, 'TRANSLATION_COMPLETE', 'system', {
      fields_normalized: Object.keys(normalized).length,
    }, traceId);

    const route = await this.routeEngine.resolve(normalized);
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

    const translated = await this.translator.fromCanonical(route.destination, normalized);
    await this.paymentRepo.updateTranslated(paymentId, translated);

    await this.publisher.publishToAdapter(route.destination, {
      payment_id: paymentId,
      trace_id: traceId,
      canonical: normalized,
      destination_rail: route.destination,
      route_rule_applied: route.ruleName,
      routed_at: new Date().toISOString(),
    });
    await this.paymentRepo.updateStatus(paymentId, PAYMENT_STATUS.QUEUED);
    await this.auditService.log(paymentId, 'STATUS_CHANGE', 'system', {
      from_status: PAYMENT_STATUS.ROUTED,
      to_status: PAYMENT_STATUS.QUEUED,
    }, traceId);

    this.logger.info({ payment_id: paymentId, destination: route.destination }, 'Payment pipeline completed');

    return {
      payment_id: paymentId,
      status: PAYMENT_STATUS.RECEIVED,
      created_at: now,
      destination_rail: route.destination,
    };
  }

  private inferRail(alias: string): string {
    if (alias.startsWith('PIX-')) return 'PIX';
    if (alias.startsWith('SPEI-')) return 'SPEI';
    throw new Error(`Cannot infer rail from alias: ${alias}`);
  }
}
