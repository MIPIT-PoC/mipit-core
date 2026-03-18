jest.mock('../../../src/observability/logger.js', () => {
  const child = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  return { logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), child: jest.fn(() => child) } };
});

jest.mock('../../../src/observability/metrics.js', () => ({
  recordPayment: jest.fn(),
}));

import { AckConsumer } from '../../../src/messaging/consumer.js';
import { PAYMENT_STATUS } from '../../../src/config/constants.js';
import { recordPayment } from '../../../src/observability/metrics.js';

function buildAckMsg(overrides: Record<string, unknown> = {}) {
  return {
    payment_id: 'PMT-TEST123',
    trace_id: 'trace-001',
    source_rail: 'PIX',
    adapter_id: 'adapter-pix-1',
    instance_id: 'inst-001',
    status: 'ACKED_BY_RAIL',
    rail_ack: { status: 'ACCEPTED', rail_tx_id: 'TX-001' },
    latency_ms: 150,
    processed_at: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

function buildFakeMsg(body: unknown) {
  return {
    content: Buffer.from(JSON.stringify(body)),
    fields: {} as any,
    properties: {} as any,
  };
}

function buildMocks() {
  let consumeCallback: Function | null = null;
  const channel = {
    consume: jest.fn((_queue: string, cb: Function) => {
      consumeCallback = cb;
      return Promise.resolve({ consumerTag: 'test-tag' });
    }),
    ack: jest.fn(),
    nack: jest.fn(),
  };

  const paymentRepo = {
    updateAck: jest.fn().mockResolvedValue({}),
  };

  const auditService = {
    log: jest.fn().mockResolvedValue(undefined),
  };

  return {
    channel,
    paymentRepo,
    auditService,
    getCallback: () => consumeCallback!,
  };
}

describe('AckConsumer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should register consumer on payments.ack queue', async () => {
    const m = buildMocks();
    const consumer = new AckConsumer(m.channel as any, m.paymentRepo as any, m.auditService as any);

    await consumer.start();

    expect(m.channel.consume).toHaveBeenCalledWith('payments.ack', expect.any(Function));
  });

  it('should update payment to COMPLETED on ACCEPTED ack', async () => {
    const m = buildMocks();
    const consumer = new AckConsumer(m.channel as any, m.paymentRepo as any, m.auditService as any);
    await consumer.start();

    await m.getCallback()(buildFakeMsg(buildAckMsg({ rail_ack: { status: 'ACCEPTED' } })));

    expect(m.paymentRepo.updateAck).toHaveBeenCalledWith('PMT-TEST123', { status: 'ACCEPTED' }, PAYMENT_STATUS.COMPLETED);
  });

  it('should update payment to REJECTED on REJECTED ack', async () => {
    const m = buildMocks();
    const consumer = new AckConsumer(m.channel as any, m.paymentRepo as any, m.auditService as any);
    await consumer.start();

    await m.getCallback()(buildFakeMsg(buildAckMsg({ rail_ack: { status: 'REJECTED', error: { code: 'R01', message: 'Insufficient funds' } } })));

    expect(m.paymentRepo.updateAck).toHaveBeenCalledWith(
      'PMT-TEST123',
      expect.objectContaining({ status: 'REJECTED' }),
      PAYMENT_STATUS.REJECTED,
    );
  });

  it('should update payment to FAILED on ERROR ack', async () => {
    const m = buildMocks();
    const consumer = new AckConsumer(m.channel as any, m.paymentRepo as any, m.auditService as any);
    await consumer.start();

    await m.getCallback()(buildFakeMsg(buildAckMsg({ rail_ack: { status: 'ERROR' } })));

    expect(m.paymentRepo.updateAck).toHaveBeenCalledWith('PMT-TEST123', { status: 'ERROR' }, PAYMENT_STATUS.FAILED);
  });

  it('should log audit event with adapter and latency metadata', async () => {
    const m = buildMocks();
    const consumer = new AckConsumer(m.channel as any, m.paymentRepo as any, m.auditService as any);
    await consumer.start();

    await m.getCallback()(buildFakeMsg(buildAckMsg()));

    expect(m.auditService.log).toHaveBeenCalledWith(
      'PMT-TEST123',
      'ACK_RECEIVED',
      'adapter-pix',
      expect.objectContaining({ adapter_id: 'adapter-pix-1', latency_ms: 150 }),
      'trace-001',
    );
  });

  it('should call channel.ack after successful processing', async () => {
    const m = buildMocks();
    const consumer = new AckConsumer(m.channel as any, m.paymentRepo as any, m.auditService as any);
    await consumer.start();

    const msg = buildFakeMsg(buildAckMsg());
    await m.getCallback()(msg);

    expect(m.channel.ack).toHaveBeenCalledWith(msg);
  });

  it('should nack without requeue on invalid JSON', async () => {
    const m = buildMocks();
    const consumer = new AckConsumer(m.channel as any, m.paymentRepo as any, m.auditService as any);
    await consumer.start();

    const badMsg = { content: Buffer.from('not-json'), fields: {} as any, properties: {} as any };
    await m.getCallback()(badMsg);

    expect(m.channel.nack).toHaveBeenCalledWith(badMsg, false, false);
    expect(m.paymentRepo.updateAck).not.toHaveBeenCalled();
  });

  it('should nack without requeue when updateAck fails', async () => {
    const m = buildMocks();
    m.paymentRepo.updateAck.mockRejectedValue(new Error('DB down'));
    const consumer = new AckConsumer(m.channel as any, m.paymentRepo as any, m.auditService as any);
    await consumer.start();

    const msg = buildFakeMsg(buildAckMsg());
    await m.getCallback()(msg);

    expect(m.channel.nack).toHaveBeenCalledWith(msg, false, false);
  });

  it('should nack without requeue when payment_id is missing', async () => {
    const m = buildMocks();
    const consumer = new AckConsumer(m.channel as any, m.paymentRepo as any, m.auditService as any);
    await consumer.start();

    const msg = buildFakeMsg({ rail_ack: { status: 'ACCEPTED' } });
    await m.getCallback()(msg);

    expect(m.channel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(m.paymentRepo.updateAck).not.toHaveBeenCalled();
  });

  it('should return without processing when msg is null', async () => {
    const m = buildMocks();
    const consumer = new AckConsumer(m.channel as any, m.paymentRepo as any, m.auditService as any);
    await consumer.start();

    await m.getCallback()(null);

    expect(m.paymentRepo.updateAck).not.toHaveBeenCalled();
    expect(m.channel.ack).not.toHaveBeenCalled();
  });

  it('should record payment metric after processing', async () => {
    const m = buildMocks();
    const consumer = new AckConsumer(m.channel as any, m.paymentRepo as any, m.auditService as any);
    await consumer.start();

    await m.getCallback()(buildFakeMsg(buildAckMsg()));

    expect(recordPayment).toHaveBeenCalledWith(PAYMENT_STATUS.COMPLETED, 'PIX', 'SPEI');
  });
});
