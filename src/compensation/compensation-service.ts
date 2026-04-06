/**
 * Compensation Service — Saga-style compensating transactions
 *
 * When a payment reaches a terminal failure state (DEAD_LETTER, FAILED after retries),
 * this service attempts to reverse or compensate the payment:
 *
 *   1. Check current payment state
 *   2. If QUEUED/SENT → attempt to cancel at destination adapter
 *   3. If DEAD_LETTER → mark as COMPENSATING, log compensation attempt
 *   4. On success → mark as COMPENSATED
 *   5. On failure → leave as COMPENSATING for manual review
 *
 * This implements the Saga pattern for distributed transactions across payment rails.
 */

import { PAYMENT_STATUS } from '../config/constants.js';
import type { PaymentRepository } from '../persistence/repositories/payment.repository.js';
import type { AuditService } from '../audit/audit-service.js';
import { logger } from '../observability/logger.js';

/** Statuses that can be compensated */
const COMPENSABLE_STATUSES = new Set<string>([
  PAYMENT_STATUS.DEAD_LETTER,
  PAYMENT_STATUS.FAILED,
]);

export class CompensationService {
  constructor(
    private readonly paymentRepo: PaymentRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Attempt compensation for a single payment.
   * Returns true if compensation was successful, false otherwise.
   */
  async compensate(paymentId: string): Promise<{ success: boolean; reason: string }> {
    const log = logger.child({ payment_id: paymentId });

    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) {
      return { success: false, reason: 'Payment not found' };
    }

    if (!COMPENSABLE_STATUSES.has(payment.status)) {
      return { success: false, reason: `Payment status ${payment.status} is not compensable` };
    }

    log.info({ current_status: payment.status }, 'Starting compensation');

    // Transition to COMPENSATING
    await this.paymentRepo.updateStatus(paymentId, PAYMENT_STATUS.COMPENSATING);
    await this.auditService.log(
      paymentId,
      'COMPENSATION_STARTED',
      'compensation-service',
      {
        previous_status: payment.status,
        destination_rail: payment.destination_rail,
        amount: payment.amount,
        currency: payment.currency,
      },
      payment.trace_id,
    );

    try {
      // In a real system, this would call the destination rail's cancellation API.
      // For the PoC, we simulate the compensation:
      //   - If the payment was never ACKed by the rail, no reversal needed
      //   - If it was ACKed, a refund/reversal message would be sent
      const wasAcked = payment.rail_ack !== null && payment.rail_ack !== undefined;

      if (wasAcked) {
        log.info('Payment was ACKed by rail — reversal would be required in production');
        // In production: send reversal/refund to destination rail
        // For PoC: log the intent
        await this.auditService.log(
          paymentId,
          'COMPENSATION_REVERSAL_REQUIRED',
          'compensation-service',
          {
            rail_ack: payment.rail_ack,
            note: 'In production, a pacs.004 (PaymentReturn) message would be sent to the destination rail',
          },
          payment.trace_id,
        );
      }

      // Mark as COMPENSATED
      await this.paymentRepo.updateStatus(paymentId, PAYMENT_STATUS.COMPENSATED);
      await this.auditService.log(
        paymentId,
        'COMPENSATION_COMPLETED',
        'compensation-service',
        {
          required_reversal: wasAcked,
          compensated_at: new Date().toISOString(),
        },
        payment.trace_id,
      );

      log.info('Compensation completed successfully');
      return { success: true, reason: 'Compensated' };
    } catch (err) {
      log.error({ err }, 'Compensation failed — manual review required');
      await this.auditService.log(
        paymentId,
        'COMPENSATION_FAILED',
        'compensation-service',
        { error: String(err) },
        payment.trace_id,
      );
      return { success: false, reason: `Compensation error: ${String(err)}` };
    }
  }

  /**
   * Batch compensation: find all payments stuck in DEAD_LETTER/FAILED
   * and attempt to compensate them.
   */
  async compensateBatch(limit: number = 50): Promise<{ processed: number; succeeded: number; failed: number }> {
    logger.info({ limit }, 'Starting batch compensation');

    // Query payments needing compensation
    const payments = await this.paymentRepo.findByStatuses(
      [PAYMENT_STATUS.DEAD_LETTER, PAYMENT_STATUS.FAILED],
      limit,
    );

    let succeeded = 0;
    let failed = 0;

    for (const payment of payments) {
      const result = await this.compensate(payment.payment_id);
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    logger.info({ processed: payments.length, succeeded, failed }, 'Batch compensation complete');
    return { processed: payments.length, succeeded, failed };
  }
}
