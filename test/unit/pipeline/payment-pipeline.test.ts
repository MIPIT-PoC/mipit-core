jest.mock('ulid', () => ({ ulid: () => 'MOCK01ULID00000000000' }));

jest.mock('../../../src/observability/metrics.js', () => ({
  startLatencyTimer: jest.fn(() => jest.fn()),
}));

import { PaymentPipeline } from '../../../src/pipeline/payment-pipeline.js';
import { PAYMENT_STATUS } from '../../../src/config/constants.js';

function buildMocks() {
  const translator = {
    toCanonical: jest.fn().mockResolvedValue({
      payment_id: 'PMT-MOCK01ULID00000000000',
      amount: { value: 100, currency: 'BRL' },
      origin: { rail: 'PIX' },
    }),
    fromCanonical: jest.fn().mockResolvedValue({ pixKey: 'abc', amount: 100 }),
  };

  const normalizer = {
    normalize: jest.fn().mockImplementation((c) => Promise.resolve(c)),
  };

  const routeEngine = {
    resolve: jest.fn().mockResolvedValue({ destination: 'SPEI', ruleName: 'pix-to-spei' }),
  };

  const publisher = { publishToAdapter: jest.fn().mockResolvedValue(undefined) };

  const paymentRepo = {
    create: jest.fn().mockResolvedValue({}),
    updateStatus: jest.fn().mockResolvedValue({}),
    updateCanonical: jest.fn().mockResolvedValue({}),
    updateRoute: jest.fn().mockResolvedValue({}),
    updateTranslated: jest.fn().mockResolvedValue({}),
  };

  const auditService = {
    log: jest.fn().mockResolvedValue(undefined),
    logRoutingDecision: jest.fn().mockResolvedValue(undefined),
    logError: jest.fn().mockResolvedValue(undefined),
  };

  const childLogger = { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() };
  const logger = { child: jest.fn(() => childLogger), info: jest.fn(), error: jest.fn() } as any;

  return { translator, normalizer, routeEngine, publisher, paymentRepo, auditService, logger, childLogger };
}

function buildRequest(overrides: Record<string, unknown> = {}) {
  return {
    amount: 100,
    currency: 'BRL',
    debtor: { alias: 'PIX-abc123', name: 'Alice' },
    creditor: { alias: 'SPEI-def456', name: 'Bob' },
    purpose: 'P2P',
    reference: 'REF001',
    ...overrides,
  } as any;
}

describe('PaymentPipeline', () => {
  it('should return payment_id and QUEUED status for a valid PIX request', async () => {
    const m = buildMocks();
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    const result = await pipeline.execute(buildRequest(), { traceId: 'trace-1' });

    expect(result.payment_id).toMatch(/^PMT-/);
    expect(result.status).toBe(PAYMENT_STATUS.QUEUED);
    expect(result.destination_rail).toBe('SPEI');
  });

  it('should infer PIX rail for alias starting with PIX-', async () => {
    const m = buildMocks();
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    await pipeline.execute(buildRequest(), {});
    expect(m.paymentRepo.create).toHaveBeenCalledWith(expect.objectContaining({ origin_rail: 'PIX' }));
  });

  it('should infer SPEI rail for alias starting with SPEI-', async () => {
    const m = buildMocks();
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    await pipeline.execute(buildRequest({ debtor: { alias: 'SPEI-xyz', name: 'Carlos' } }), {});
    expect(m.paymentRepo.create).toHaveBeenCalledWith(expect.objectContaining({ origin_rail: 'SPEI' }));
  });

  it('should throw for unknown alias prefix', async () => {
    const m = buildMocks();
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    await expect(
      pipeline.execute(buildRequest({ debtor: { alias: 'UNKNOWN-aaa', name: 'X' } }), {}),
    ).rejects.toThrow('Cannot infer rail from alias');
  });

  it('should call translator.toCanonical with correct rail and payload', async () => {
    const m = buildMocks();
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );
    const req = buildRequest();

    await pipeline.execute(req, { traceId: 'trace-2' });

    expect(m.translator.toCanonical).toHaveBeenCalledWith('PIX', req, expect.stringMatching(/^PMT-/), 'trace-2');
  });

  it('should call normalizer.normalize with canonical', async () => {
    const m = buildMocks();
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    await pipeline.execute(buildRequest(), {});
    expect(m.normalizer.normalize).toHaveBeenCalledTimes(1);
  });

  it('should call routeEngine.resolve and publisher.publishToAdapter', async () => {
    const m = buildMocks();
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    await pipeline.execute(buildRequest(), {});

    expect(m.routeEngine.resolve).toHaveBeenCalledTimes(1);
    expect(m.publisher.publishToAdapter).toHaveBeenCalledWith('SPEI', expect.objectContaining({ destination_rail: 'SPEI' }));
  });

  it('should call updateStatus with QUEUED after publishing', async () => {
    const m = buildMocks();
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    await pipeline.execute(buildRequest(), {});
    expect(m.paymentRepo.updateStatus).toHaveBeenCalledWith(expect.stringMatching(/^PMT-/), PAYMENT_STATUS.QUEUED);
  });

  it('should register multiple audit events during pipeline', async () => {
    const m = buildMocks();
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    await pipeline.execute(buildRequest(), {});

    expect(m.auditService.log.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(m.auditService.logRoutingDecision).toHaveBeenCalledTimes(1);
  });

  it('should set status FAILED and log error when translator throws', async () => {
    const m = buildMocks();
    m.translator.toCanonical.mockRejectedValue(new Error('Translation boom'));
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    await expect(pipeline.execute(buildRequest(), {})).rejects.toThrow('Translation boom');
    expect(m.paymentRepo.updateStatus).toHaveBeenCalledWith(expect.any(String), PAYMENT_STATUS.FAILED);
    expect(m.auditService.logError).toHaveBeenCalledTimes(1);
  });

  it('should set status FAILED when routeEngine throws', async () => {
    const m = buildMocks();
    m.routeEngine.resolve.mockRejectedValue(new Error('No route'));
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    await expect(pipeline.execute(buildRequest(), {})).rejects.toThrow('No route');
    expect(m.paymentRepo.updateStatus).toHaveBeenCalledWith(expect.any(String), PAYMENT_STATUS.FAILED);
  });
});
