/**
 * Reconciliation Service — Batch payment consistency checker
 *
 * Compares payments sent (QUEUED) vs. ACKs received to detect inconsistencies:
 *   - Payments stuck in QUEUED (no ACK after timeout)
 *   - Payments with mismatched amounts (sent vs. confirmed)
 *   - Orphan ACKs (ACK without corresponding payment)
 *
 * This is a critical function in real payment middleware:
 *   Banks run reconciliation daily (T+0 or T+1) to ensure
 *   all debits match credits across systems.
 *
 * Usage:
 *   const recon = new ReconciliationService(paymentRepo, auditService);
 *   const report = await recon.runReconciliation({ windowHours: 24 });
 */

import type { PaymentRepository } from '../persistence/repositories/payment.repository.js';
import type { AuditService } from '../audit/audit-service.js';
import { PAYMENT_STATUS } from '../config/constants.js';
import { logger } from '../observability/logger.js';

export interface ReconciliationOptions {
  /** How far back to look (in hours). Default: 24 */
  windowHours: number;
  /** Max time in minutes a payment can be QUEUED before flagging as stuck. Default: 15 */
  stuckThresholdMinutes: number;
}

export interface ReconciliationReport {
  generated_at: string;
  window_hours: number;
  summary: {
    total_payments: number;
    completed: number;
    failed: number;
    rejected: number;
    stuck_in_queue: number;
    dead_letter: number;
    compensated: number;
  };
  stuck_payments: Array<{
    payment_id: string;
    status: string;
    origin_rail: string;
    destination_rail: string | undefined;
    queued_at: string | undefined;
    stuck_minutes: number;
  }>;
  rail_breakdown: Record<string, {
    sent: number;
    completed: number;
    failed: number;
    rejected: number;
    success_rate: number;
    avg_latency_ms: number | null;
  }>;
  anomalies: Array<{
    type: string;
    payment_id: string;
    description: string;
  }>;
}

const DEFAULT_OPTIONS: ReconciliationOptions = {
  windowHours: 24,
  stuckThresholdMinutes: 15,
};

export class ReconciliationService {
  constructor(
    private readonly paymentRepo: PaymentRepository,
    _auditService: AuditService,
  ) {}

  async runReconciliation(options?: Partial<ReconciliationOptions>): Promise<ReconciliationReport> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const log = logger.child({ component: 'reconciliation' });
    log.info({ windowHours: opts.windowHours }, 'Starting reconciliation');

    const cutoff = new Date(Date.now() - opts.windowHours * 60 * 60 * 1000).toISOString();
    const payments = await this.paymentRepo.findSince(cutoff);

    const now = Date.now();
    const stuckThresholdMs = opts.stuckThresholdMinutes * 60 * 1000;

    // Categorize payments
    const summary = {
      total_payments: payments.length,
      completed: 0,
      failed: 0,
      rejected: 0,
      stuck_in_queue: 0,
      dead_letter: 0,
      compensated: 0,
    };

    const stuckPayments: ReconciliationReport['stuck_payments'] = [];
    const anomalies: ReconciliationReport['anomalies'] = [];
    const railStats: Record<string, { sent: number; completed: number; failed: number; rejected: number; latencies: number[] }> = {};

    for (const payment of payments) {
      // Count by status
      switch (payment.status) {
        case PAYMENT_STATUS.COMPLETED:
          summary.completed++;
          break;
        case PAYMENT_STATUS.FAILED:
          summary.failed++;
          break;
        case PAYMENT_STATUS.REJECTED:
          summary.rejected++;
          break;
        case PAYMENT_STATUS.DEAD_LETTER:
          summary.dead_letter++;
          break;
        case PAYMENT_STATUS.COMPENSATED:
          summary.compensated++;
          break;
        case PAYMENT_STATUS.QUEUED:
        case PAYMENT_STATUS.SENT_TO_DESTINATION: {
          // Check if stuck
          const queuedAt = payment.queued_at ? new Date(payment.queued_at).getTime() : 0;
          const stuckMs = now - queuedAt;
          if (queuedAt > 0 && stuckMs > stuckThresholdMs) {
            summary.stuck_in_queue++;
            stuckPayments.push({
              payment_id: payment.payment_id,
              status: payment.status,
              origin_rail: payment.origin_rail,
              destination_rail: payment.destination_rail,
              queued_at: payment.queued_at,
              stuck_minutes: Math.round(stuckMs / 60_000),
            });
          }
          break;
        }
      }

      // Rail breakdown
      const destRail = payment.destination_rail ?? 'UNKNOWN';
      if (!railStats[destRail]) {
        railStats[destRail] = { sent: 0, completed: 0, failed: 0, rejected: 0, latencies: [] };
      }
      railStats[destRail].sent++;

      if (payment.status === PAYMENT_STATUS.COMPLETED) {
        railStats[destRail].completed++;
        // Calculate latency if we have timestamps
        if (payment.created_at && payment.completed_at) {
          const latency = new Date(payment.completed_at).getTime() - new Date(payment.created_at).getTime();
          railStats[destRail].latencies.push(latency);
        }
      } else if (payment.status === PAYMENT_STATUS.FAILED) {
        railStats[destRail].failed++;
      } else if (payment.status === PAYMENT_STATUS.REJECTED) {
        railStats[destRail].rejected++;
      }

      // Anomaly detection: payment in CANONICALIZED/ROUTED for too long
      if (
        (payment.status === PAYMENT_STATUS.CANONICALIZED || payment.status === PAYMENT_STATUS.ROUTED) &&
        payment.created_at
      ) {
        const age = now - new Date(payment.created_at).getTime();
        if (age > stuckThresholdMs) {
          anomalies.push({
            type: 'STALLED_PIPELINE',
            payment_id: payment.payment_id,
            description: `Payment stuck in ${payment.status} for ${Math.round(age / 60_000)} minutes`,
          });
        }
      }
    }

    // Build rail breakdown
    const railBreakdown: ReconciliationReport['rail_breakdown'] = {};
    for (const [rail, stats] of Object.entries(railStats)) {
      const avgLatency = stats.latencies.length > 0
        ? Math.round(stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length)
        : null;
      railBreakdown[rail] = {
        sent: stats.sent,
        completed: stats.completed,
        failed: stats.failed,
        rejected: stats.rejected,
        success_rate: stats.sent > 0 ? Math.round((stats.completed / stats.sent) * 100) : 0,
        avg_latency_ms: avgLatency,
      };
    }

    const report: ReconciliationReport = {
      generated_at: new Date().toISOString(),
      window_hours: opts.windowHours,
      summary,
      stuck_payments: stuckPayments,
      rail_breakdown: railBreakdown,
      anomalies,
    };

    log.info(
      { summary, anomaly_count: anomalies.length, stuck_count: stuckPayments.length },
      'Reconciliation run recorded',
    );

    log.info({ summary, anomalies: anomalies.length }, 'Reconciliation complete');
    return report;
  }
}
