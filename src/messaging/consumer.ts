import type { Channel } from 'amqplib';
import { QUEUES, PAYMENT_STATUS } from '../config/constants.js';
import type { PaymentRepository } from '../persistence/repositories/payment.repository.js';
import type { AuditService } from '../audit/audit-service.js';
import type { WebhookService } from '../webhooks/webhook.service.js';
import { logger } from '../observability/logger.js';
import { recordPayment } from '../observability/metrics.js';
import { broadcastPaymentEvent } from '../api/routes/sse.js';
import { legacyStatusToTxSts, type Pacs002TxStatus } from '../canonical/pacs002.schema.js';
import { mapRailRejectionToIso } from '../translation/rail-rejection-mapping.js';

/**
 * Legacy adapter ACK shape (PIX/SPEI/Bre-B currently emit this).
 * P01: We add `txSts` ISO 20022 codes at the consumer; adapters continue
 * to emit their legacy `rail_ack.status` for backward compatibility.
 */
interface PaymentAckMessage {
  payment_id: string;
  trace_id: string;
  uetr?: string; // P01: optional now, mandatory once P02/P03/P04 land
  source_rail: string;
  adapter_id: string;
  instance_id: string;
  status: 'ACKED_BY_RAIL' | 'REJECTED' | 'FAILED';
  rail_ack: {
    rail_tx_id?: string;
    status: 'ACCEPTED' | 'REJECTED' | 'ERROR' | 'PENDING';
    error?: { code: string; message: string };
    raw_response?: Record<string, unknown>;
  };
  /** Pacs.002-derived enriched ack shape — populated by P02/P03/P04 adapters. */
  pacs002?: {
    msgId: string;
    orgnlMsgId: string;
    orgnlEndToEndId: string;
    orgnlUetr: string;
    txSts: Pacs002TxStatus;
    stsRsnInf?: { rsn: { cd?: string; prtry?: string }; addtlInf?: string[] };
  };
  latency_ms: number;
  processed_at: string;
}

export class AckConsumer {
  constructor(
    private channel: Channel,
    private paymentRepo: PaymentRepository,
    private auditService: AuditService,
    private webhookService?: WebhookService,
  ) {}

  async start() {
    logger.info({ queue: QUEUES.ACK }, 'AckConsumer started');

    await this.channel.consume(QUEUES.ACK, async (msg) => {
      if (!msg) return;

      let ack: PaymentAckMessage;
      try {
        ack = JSON.parse(msg.content.toString());
      } catch (parseErr) {
        logger.error({ err: parseErr, raw: msg.content.toString().slice(0, 200) }, 'Failed to parse ACK message');
        this.channel.nack(msg, false, false);
        return;
      }

      if (!ack.payment_id || !ack.rail_ack?.status) {
        logger.warn({ payment_id: ack.payment_id }, 'Invalid ACK message structure — missing required fields');
        this.channel.nack(msg, false, false);
        return;
      }

      const log = logger.child({ payment_id: ack.payment_id, source_rail: ack.source_rail, uetr: ack.uetr });

      try {
        // ISO 20022 TxSts (prefer the enriched pacs.002 shape if adapter sent it).
        const txSts: Pacs002TxStatus = ack.pacs002?.txSts ?? legacyStatusToTxSts(ack.rail_ack.status);

        let finalStatus: string;
        switch (txSts) {
          case 'ACSC':
            finalStatus = PAYMENT_STATUS.COMPLETED;
            break;
          case 'ACSP':
            finalStatus = PAYMENT_STATUS.ACKED_BY_RAIL;
            break;
          case 'RJCT':
            // Differentiate transport-level error vs business rejection
            finalStatus = ack.rail_ack.status === 'ERROR'
              ? PAYMENT_STATUS.FAILED
              : PAYMENT_STATUS.REJECTED;
            break;
          case 'PDNG':
            finalStatus = PAYMENT_STATUS.QUEUED; // keep queued, await further ack
            break;
          case 'PART':
            finalStatus = PAYMENT_STATUS.ACKED_BY_RAIL;
            break;
          default:
            finalStatus = PAYMENT_STATUS.FAILED;
        }

        // W6.2 — when the rail rejected, map its proprietary code to an ISO
        // ExternalStatusReason1Code (Rsn.Cd) while preserving the original
        // in Rsn.Prtry. Lets downstream pacs.002 readers route on standard
        // codes without losing audit trail of the rail-native code.
        const isoReason = (txSts === 'RJCT' && (ack.source_rail === 'PIX' || ack.source_rail === 'SPEI' || ack.source_rail === 'BRE_B'))
          ? mapRailRejectionToIso(ack.source_rail, ack.rail_ack.error?.code)
          : undefined;

        // Persist rail_ack (enrich with ISO codes for downstream observability).
        const enrichedRailAck = {
          ...ack.rail_ack,
          tx_sts: txSts,
          orgnl_end_to_end_id: ack.pacs002?.orgnlEndToEndId,
          orgnl_uetr: ack.pacs002?.orgnlUetr ?? ack.uetr,
          // ISO rejection reason (W6.2) — added on top of error.code (preserved).
          sts_rsn_inf: isoReason
            ? { rsn: { cd: isoReason.cd, prtry: isoReason.prtry } }
            : ack.pacs002?.stsRsnInf,
        };

        const updatedPayment = await this.paymentRepo.updateRailAck(ack.payment_id, enrichedRailAck, finalStatus);
        log.info({ final_status: finalStatus, tx_sts: txSts, latency_ms: ack.latency_ms }, 'Payment status updated from ACK');

        const actor = `adapter-${ack.source_rail.toLowerCase()}`;
        await this.auditService.log(
          ack.payment_id,
          'ACK_RECEIVED',
          actor,
          {
            rail_status: ack.rail_ack.status,
            tx_sts: txSts,
            final_payment_status: finalStatus,
            adapter_id: ack.adapter_id,
            instance_id: ack.instance_id,
            latency_ms: ack.latency_ms,
            rail_tx_id: ack.rail_ack.rail_tx_id,
            error: ack.rail_ack.error,
            uetr: ack.pacs002?.orgnlUetr ?? ack.uetr,
          },
          ack.trace_id,
        );

        // P06: read destination_rail from DB (was hard-coded to inverse of source).
        const destRail = (updatedPayment as any).destination_rail ?? null;
        recordPayment(finalStatus, ack.source_rail, destRail ?? 'UNKNOWN');

        // Broadcast SSE event for real-time UI
        broadcastPaymentEvent({
          payment_id: ack.payment_id,
          status: finalStatus,
          origin_rail: ack.source_rail,
          destination_rail: destRail,
          latency_ms: ack.latency_ms,
          error: ack.rail_ack.error?.message,
          tx_sts: txSts,
          timestamp: ack.processed_at,
        });

        // Fire webhooks for terminal status (COMPLETED / FAILED / REJECTED)
        if (this.webhookService && ['COMPLETED', 'FAILED', 'REJECTED'].includes(finalStatus)) {
          this.webhookService.fireForPayment(updatedPayment).catch((err) => {
            log.warn({ err }, 'Webhook delivery error (non-blocking)');
          });
        }

        this.channel.ack(msg);
        log.info('ACK message processed successfully');
      } catch (err) {
        log.error({ err }, 'Failed to process ACK message');
        this.channel.nack(msg, false, false);
      }
    });
  }
}
