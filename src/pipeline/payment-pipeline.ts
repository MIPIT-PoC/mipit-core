import { ulid } from 'ulid';
import { randomUUID } from 'node:crypto';
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
import { startLatencyTimer, recordPayment } from '../observability/metrics.js';
import { broadcastPaymentEvent } from '../api/routes/sse.js';
import type { RateLimiter } from '../resilience/rate-limiter.js';

export class PaymentPipeline {
  constructor(
    private readonly translator: Translator,
    private readonly normalizer: Normalizer,
    private readonly routeEngine: RouteEngine,
    private readonly publisher: Publisher,
    private readonly paymentRepo: PaymentRepository,
    private readonly auditService: AuditService,
    private readonly logger: Logger,
    /** P06 — optional rate limiter; consumed in step 6 (route) per destination rail. */
    private readonly rateLimiter?: RateLimiter,
  ) {}

  async execute(
    request: CreatePaymentRequest,
    context: { idempotencyKey?: string; traceId?: string; paymentId?: string },
  ) {
    const stopTotal = startLatencyTimer('pipeline_total');
    const paymentId = context.paymentId ?? `PMT-${ulid()}`;
    const traceId = context.traceId ?? ulid();
    const now = new Date().toISOString();

    // P01: Generate UETR upfront — propagates through the entire chain
    //      (pacs.008 outbound, pacs.002 ack, pacs.004 return).
    const uetr = randomUUID();
    const intrBkSttlmDt = now.slice(0, 10); // ISODate YYYY-MM-DD
    const chargeBearer = request.chargeBearer ?? 'SLEV';

    const log = this.logger.child({ payment_id: paymentId, trace_id: traceId, uetr });

    const originRail = this.inferRail(request.debtor.alias);
    log.info({ origin_rail: originRail }, 'Step 1: Rail inferred from debtor alias');

    try {
      // Step 2: Persist with status RECEIVED, including ISO 20022 columns
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
        // P01 — ISO 20022 columns
        uetr,
        charge_bearer: chargeBearer,
        interbank_settlement_date: intrBkSttlmDt,
        // instructed = original (settlement filled later post-FX)
        instructed_amount: request.amount,
        instructed_currency: request.currency,
      } as any);
      await this.auditService.log(paymentId, 'PAYMENT_RECEIVED', 'system', {
        origin_rail: originRail,
        amount: request.amount,
        currency: request.currency,
        uetr,
        charge_bearer: chargeBearer,
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

      // Step 4: Translate to canonical (pacs.008-derived) -> CANONICALIZED
      const stopTranslation = startLatencyTimer('pipeline_to_canonical');
      const canonicalRaw: CanonicalPacs008 = await this.translator.toCanonical(
        originRail,
        request,
        paymentId,
        traceId,
      );
      stopTranslation();

      // P01 — Stamp the mandatory ISO 20022 fields onto the canonical.
      //        Translators may return without these (legacy code paths).
      const existingPmtId = canonicalRaw.pmtId ?? { endToEndId: `E2E-${paymentId}` };
      const canonical: CanonicalPacs008 = {
        ...canonicalRaw,
        chrgBr: chargeBearer,
        intrBkSttlmDt,
        pmtId: {
          ...existingPmtId,
          uetr,
          txId: existingPmtId.txId ?? existingPmtId.endToEndId,
        },
      };

      // P02 — Persist the canonical EndToEndId into the dedicated DB column
      // so it's queryable without diving into the JSONB. Bounded to 35 chars
      // per ISO 20022 spec (DB column is VARCHAR(35)).
      try {
        const e2e = canonical.pmtId.endToEndId?.slice(0, 35);
        if (e2e) {
          await this.paymentRepo.updateEndToEndId(paymentId, e2e);
        }
      } catch (err) {
        log.warn({ err }, 'updateEndToEndId failed (non-fatal)');
      }

      await this.paymentRepo.updateCanonical(paymentId, canonical, PAYMENT_STATUS.CANONICALIZED);
      await this.auditService.log(paymentId, 'CANONICAL_UPDATED', 'system-translator', {
        pacs008_version: 'pacs.008.001.10-derived',
        fields_count: Object.keys(canonical).length,
        uetr,
      }, traceId);
      log.info('Step 4: Translated to canonical (pacs.008-derived)');

      // Step 5: Normalize
      const stopNormalization = startLatencyTimer('pipeline_normalization');
      const normalized = await this.normalizer.normalize(canonical);
      stopNormalization();
      await this.auditService.log(paymentId, 'NORMALIZATION_COMPLETE', 'system', {
        currency: normalized.amount.currency,
        has_fx: !!normalized.fx?.target_currency,
      }, traceId);
      log.info({ currency: normalized.amount.currency }, 'Step 5: Normalization complete');

      // Persist FX + settlement amounts post-normalize (P01 / P05)
      try {
        await this.paymentRepo.updateFxAndSettlement(
          paymentId,
          { amount: request.amount, currency: request.currency },
          { amount: normalized.amount.value, currency: normalized.amount.currency },
          normalized.fx?.rate ?? null,
          normalized.fx?.source_provider ?? null,
        );
      } catch (err) {
        log.warn({ err }, 'updateFxAndSettlement failed (non-fatal)');
      }

      // Step 6: Route -> ROUTED
      const stopRouting = startLatencyTimer('pipeline_routing');
      const route = await this.routeEngine.resolve(normalized);
      stopRouting();

      // P06 — Consume one token from the destination-rail rate limiter.
      // Throws RateLimitExceededError (caught by the HTTP error handler and
      // returned as 429 with Retry-After). Previously `acquire` was dead code.
      if (this.rateLimiter) {
        try {
          this.rateLimiter.acquire(route.destination);
        } catch (err) {
          log.warn({ err, rail: route.destination }, 'Rate limit exceeded — rejecting');
          throw err;
        }
      }

      // P05 — Re-normalize with destination_rail known so FX targets the
      // destination's native currency (was using origin's, which is a no-op
      // for cross-border flows like BRL→MXN).
      normalized.destination = {
        ...(normalized.destination ?? {}),
        rail: route.destination as any,
      };
      const stopReNormalize = startLatencyTimer('pipeline_normalization');
      const reNormalized = await this.normalizer.normalize(normalized);
      stopReNormalize();
      // Copy fx + amount back onto the canonical we publish + persist.
      if (reNormalized.fx) normalized.fx = reNormalized.fx;
      // Persist the updated canonical (now with FX info) before publishing.
      try {
        await this.paymentRepo.updateCanonical(paymentId, normalized, PAYMENT_STATUS.ROUTED);
      } catch (err) {
        log.warn({ err }, 'Failed to persist post-route canonical (FX info); continuing');
      }

      await this.paymentRepo.updateRoute(
        paymentId,
        route.destination,
        route.ruleName,
        PAYMENT_STATUS.ROUTED,
        normalized.destination?.institutionCode ?? null,
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
        uetr,
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

      // Broadcast SSE event for real-time UI tracking
      broadcastPaymentEvent({
        payment_id: paymentId,
        status: PAYMENT_STATUS.QUEUED,
        origin_rail: originRail,
        destination_rail: route.destination,
        fx: normalized.fx ? {
          source_currency: normalized.fx.source_currency,
          target_currency: normalized.fx.target_currency,
          rate: normalized.fx.rate,
          converted_amount: normalized.fx.local_amount,
        } : undefined,
        timestamp: new Date().toISOString(),
      });

      stopTotal();
      log.info({ destination: route.destination }, 'Pipeline completed successfully');

      return {
        payment_id: paymentId,
        status: PAYMENT_STATUS.QUEUED,
        created_at: now,
        origin_rail: originRail,
        destination_rail: route.destination,
        route_rule_applied: route.ruleName,
        amount: request.amount,
        currency: request.currency,
        // P01 — Surface ISO 20022 fields in the response
        uetr,
        charge_bearer: chargeBearer,
        interbank_settlement_date: intrBkSttlmDt,
        fx: normalized.fx ? {
          source_currency: normalized.fx.source_currency,
          target_currency: normalized.fx.target_currency,
          rate: normalized.fx.rate,
          converted_amount: normalized.fx.local_amount,
        } : undefined,
        trace_id: traceId,
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

      // W5.4 — count pipeline failures in mipit_payments_total so Grafana
      // matches DB. Previously only the ACK consumer recorded the counter,
      // hiding failures that crashed before routing.
      recordPayment(PAYMENT_STATUS.FAILED, originRail, 'UNKNOWN');

      log.error({ err }, 'Pipeline failed');
      throw err;
    }
  }

  /**
   * Infers the origin payment rail from the debtor alias format.
   * Supports both PoC prefixes (PIX-, SPEI-, BREB-) and real-world patterns:
   *   PIX:   CPF (11 digits), CNPJ (14 digits), +55 phone, email, EVP (UUID v4)
   *   SPEI:  CLABE (18 digits)
   *   BRE_B: +57 phone, NIT format, BREB- prefix
   */
  private inferRail(alias: string): string {
    // PoC prefixes (fast path)
    if (alias.startsWith('PIX-')) return 'PIX';
    if (alias.startsWith('SPEI-')) return 'SPEI';
    if (alias.startsWith('BREB-')) return 'BRE_B';

    // PIX: CPF (11 digits)
    if (/^\d{11}$/.test(alias)) return 'PIX';
    // PIX: CNPJ (14 digits)
    if (/^\d{14}$/.test(alias)) return 'PIX';
    // PIX: Brazilian phone +55
    if (/^\+55\d{10,11}$/.test(alias)) return 'PIX';
    // PIX: EVP (UUID v4)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(alias)) return 'PIX';
    // PIX: email (generic — PIX keys can be email addresses)
    if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(alias) && !alias.startsWith('+57')) return 'PIX';

    // SPEI: CLABE (18 digits with check digit)
    if (/^\d{18}$/.test(alias)) return 'SPEI';

    // BRE_B: Colombian mobile +57 followed by `3` prefix (BanRep TR-002 — mobile-only).
    // W5.11 — was `^\+57\d{10}$` which also matched landlines; the mock rejected
    // those but the core inferred BRE_B and routed there. Now infer-equal to mock.
    if (/^\+573\d{9}$/.test(alias)) return 'BRE_B';
    // BRE_B: NIT (Colombian tax ID, 9-10 digits optionally with dash+check)
    if (/^\d{9,10}(-\d)?$/.test(alias)) return 'BRE_B';

    throw new Error(`Cannot infer rail from alias: ${alias}. Use a recognized format or prefix (PIX-, SPEI-, BREB-).`);
  }
}
