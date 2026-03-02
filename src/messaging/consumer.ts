import type { Channel } from 'amqplib';
import { QUEUES, PAYMENT_STATUS } from '../config/constants.js';
import type { PaymentRepository } from '../persistence/repositories/payment.repository.js';
import type { AuditService } from '../audit/audit-service.js';

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
    await this.channel.consume(QUEUES.ACK, async (msg) => {
      if (!msg) return;

      const ack: PaymentAckMessage = JSON.parse(msg.content.toString());

      let finalStatus: string;
      if (ack.rail_ack.status === 'ACCEPTED') {
        finalStatus = PAYMENT_STATUS.COMPLETED;
      } else if (ack.rail_ack.status === 'REJECTED') {
        finalStatus = PAYMENT_STATUS.REJECTED;
      } else {
        finalStatus = PAYMENT_STATUS.FAILED;
      }

      await this.paymentRepo.updateAck(ack.payment_id, ack.rail_ack, finalStatus);

      await this.auditService.log(
        ack.payment_id,
        `RAIL_${ack.rail_ack.status}`,
        'RAIL_ACK',
        ack.trace_id,
        {
          adapter_id: ack.adapter_id,
          instance_id: ack.instance_id,
          latency_ms: ack.latency_ms,
          rail_tx_id: ack.rail_ack.rail_tx_id,
        },
      );

      this.channel.ack(msg);
    });
  }
}
