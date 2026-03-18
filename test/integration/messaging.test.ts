jest.mock('../../src/observability/logger.js', () => {
  const child = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  return { logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), child: jest.fn(() => child) } };
});

jest.mock('../../src/observability/metrics.js', () => ({
  recordPayment: jest.fn(),
}));

import { Publisher } from '../../src/messaging/publisher.js';
import { AckConsumer } from '../../src/messaging/consumer.js';
import { PAYMENT_STATUS, EXCHANGES, ROUTING_KEYS } from '../../src/config/constants.js';

describe('Messaging (integration)', () => {
  describe('Publisher', () => {
    function buildChannel() {
      return {
        publish: jest.fn(() => true),
      };
    }

    it('should publish a message to the PIX routing key', () => {
      const ch = buildChannel();
      const pub = new Publisher(ch as any);

      pub.publishToAdapter('PIX', { payment_id: 'PMT-1', data: 'test' });

      expect(ch.publish).toHaveBeenCalledWith(
        EXCHANGES.PAYMENTS,
        ROUTING_KEYS.ROUTE_PIX,
        expect.any(Buffer),
        expect.any(Object),
      );
    });

    it('should publish a message to the SPEI routing key', () => {
      const ch = buildChannel();
      const pub = new Publisher(ch as any);

      pub.publishToAdapter('SPEI', { payment_id: 'PMT-2' });

      expect(ch.publish).toHaveBeenCalledWith(
        EXCHANGES.PAYMENTS,
        ROUTING_KEYS.ROUTE_SPEI,
        expect.any(Buffer),
        expect.any(Object),
      );
    });

    it('should set persistent and content-type headers', () => {
      const ch = buildChannel();
      const pub = new Publisher(ch as any);

      pub.publishToAdapter('PIX', { payment_id: 'PMT-3' });

      const call = ch.publish.mock.calls[0] as unknown as [string, string, Buffer, Record<string, unknown>];
      expect(call[3].persistent).toBe(true);
      expect(call[3].contentType).toBe('application/json');
    });

    it('should serialize message as JSON buffer', () => {
      const ch = buildChannel();
      const pub = new Publisher(ch as any);
      const msg = { payment_id: 'PMT-4', amount: 100 };

      pub.publishToAdapter('PIX', msg);

      const call = ch.publish.mock.calls[0] as unknown as [string, string, Buffer, Record<string, unknown>];
      expect(JSON.parse(call[2].toString())).toEqual(msg);
    });
  });

  describe('AckConsumer', () => {
    function buildConsumerMocks() {
      let callback: Function | null = null;
      const channel = {
        consume: jest.fn((_q: string, cb: Function) => { callback = cb; return Promise.resolve({ consumerTag: 'tag' }); }),
        ack: jest.fn(),
        nack: jest.fn(),
      };
      const paymentRepo = { updateAck: jest.fn().mockResolvedValue({}) };
      const auditService = { log: jest.fn().mockResolvedValue(undefined) };

      return { channel, paymentRepo, auditService, getCallback: () => callback! };
    }

    function fakeMsg(body: unknown) {
      return { content: Buffer.from(JSON.stringify(body)), fields: {} as any, properties: {} as any };
    }

    const validAck = {
      payment_id: 'PMT-INT1',
      trace_id: 'trace-int',
      source_rail: 'PIX',
      adapter_id: 'apix-1',
      instance_id: 'i-1',
      status: 'ACKED_BY_RAIL',
      rail_ack: { status: 'ACCEPTED', rail_tx_id: 'TX-100' },
      latency_ms: 200,
      processed_at: '2026-03-01T12:00:00Z',
    };

    it('should update payment to COMPLETED on ACCEPTED ack', async () => {
      const m = buildConsumerMocks();
      const consumer = new AckConsumer(m.channel as any, m.paymentRepo as any, m.auditService as any);
      await consumer.start();

      await m.getCallback()(fakeMsg(validAck));

      expect(m.paymentRepo.updateAck).toHaveBeenCalledWith('PMT-INT1', { status: 'ACCEPTED', rail_tx_id: 'TX-100' }, PAYMENT_STATUS.COMPLETED);
    });

    it('should update payment to REJECTED on REJECTED ack', async () => {
      const m = buildConsumerMocks();
      const consumer = new AckConsumer(m.channel as any, m.paymentRepo as any, m.auditService as any);
      await consumer.start();

      await m.getCallback()(fakeMsg({ ...validAck, rail_ack: { status: 'REJECTED' } }));

      expect(m.paymentRepo.updateAck).toHaveBeenCalledWith('PMT-INT1', { status: 'REJECTED' }, PAYMENT_STATUS.REJECTED);
    });

    it('should update payment to FAILED on ERROR ack', async () => {
      const m = buildConsumerMocks();
      const consumer = new AckConsumer(m.channel as any, m.paymentRepo as any, m.auditService as any);
      await consumer.start();

      await m.getCallback()(fakeMsg({ ...validAck, rail_ack: { status: 'ERROR' } }));

      expect(m.paymentRepo.updateAck).toHaveBeenCalledWith('PMT-INT1', { status: 'ERROR' }, PAYMENT_STATUS.FAILED);
    });

    it('should log audit event with adapter and latency metadata', async () => {
      const m = buildConsumerMocks();
      const consumer = new AckConsumer(m.channel as any, m.paymentRepo as any, m.auditService as any);
      await consumer.start();

      await m.getCallback()(fakeMsg(validAck));

      expect(m.auditService.log).toHaveBeenCalledWith(
        'PMT-INT1',
        'ACK_RECEIVED',
        'adapter-pix',
        expect.objectContaining({ adapter_id: 'apix-1', latency_ms: 200, rail_tx_id: 'TX-100' }),
        'trace-int',
      );
    });

    it('should acknowledge the message after processing', async () => {
      const m = buildConsumerMocks();
      const consumer = new AckConsumer(m.channel as any, m.paymentRepo as any, m.auditService as any);
      await consumer.start();

      const msg = fakeMsg(validAck);
      await m.getCallback()(msg);

      expect(m.channel.ack).toHaveBeenCalledWith(msg);
    });
  });
});
