import type { Channel } from 'amqplib';
import { QUEUES, PAYMENT_STATUS } from '../config/constants.js';
import type { PaymentRepository } from '../persistence/repositories/payment.repository.js';
import type { AuditService } from '../audit/audit-service.js';
import { logger } from '../observability/logger.js';
import { recordPayment } from '../observability/metrics.js';

interface PaymentAckMessage {
  payment_id: string;
  trace_id: string;
  source_rail: string;
  adapter_id: string;
  instance_id: string;
  status: 'ACKED_BY_RAIL' | 'REJECTED' | 'FAILED';
  rail_ack: {
    rail_tx_id?: string;
    status: 'ACCEPTED' | 'REJECTED' | 'ERROR';
    error?: { code: string; message: string };
    raw_response?: Record<string, unknown>;
  };
  latency_ms: number;
  processed_at: string;
}

export class AckConsumer {
  constructor(
    private channel: Channel,
    private paymentRepo: PaymentRepository,
    private auditService: AuditService,
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

      const log = logger.child({ payment_id: ack.payment_id, source_rail: ack.source_rail });

      try {
        let finalStatus: string;
        if (ack.rail_ack.status === 'ACCEPTED') {
          finalStatus = PAYMENT_STATUS.COMPLETED;
        } else if (ack.rail_ack.status === 'REJECTED') {
          finalStatus = PAYMENT_STATUS.REJECTED;
        } else {
          finalStatus = PAYMENT_STATUS.FAILED;
        }

        await this.paymentRepo.updateAck(ack.payment_id, ack.rail_ack, finalStatus);
        log.info({ final_status: finalStatus, latency_ms: ack.latency_ms }, 'Payment status updated from ACK');

        const actor = ack.source_rail === 'PIX' ? 'adapter-pix' : 'adapter-spei';
        await this.auditService.log(
          ack.payment_id,
          'ACK_RECEIVED',
          actor,
          {
            rail_status: ack.rail_ack.status,
            final_payment_status: finalStatus,
            adapter_id: ack.adapter_id,
            instance_id: ack.instance_id,
            latency_ms: ack.latency_ms,
            rail_tx_id: ack.rail_ack.rail_tx_id,
            error: ack.rail_ack.error,
          },
          ack.trace_id,
        );

        recordPayment(finalStatus, ack.source_rail, ack.source_rail === 'PIX' ? 'SPEI' : 'PIX');
        this.channel.ack(msg);
        log.info('ACK message processed successfully');
      } catch (err) {
        log.error({ err }, 'Failed to process ACK message');
        this.channel.nack(msg, false, false);
      }
    });
  }
}
