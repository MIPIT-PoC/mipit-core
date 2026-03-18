jest.mock('ulid', () => ({ ulid: () => 'INTEGRATIONTEST00000' }));

jest.mock('../../src/observability/logger.js', () => {
  const child = { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() };
  return { logger: { info: jest.fn(), error: jest.fn(), child: jest.fn(() => child) } };
});

jest.mock('../../src/observability/metrics.js', () => ({
  startLatencyTimer: jest.fn(() => jest.fn()),
  recordTranslationError: jest.fn(),
  recordRoutingDecision: jest.fn(),
}));

import { PaymentPipeline } from '../../src/pipeline/payment-pipeline.js';
import { PAYMENT_STATUS } from '../../src/config/constants.js';

function buildFullMocks() {
  const translator = {
    toCanonical: jest.fn().mockResolvedValue({
      payment_id: 'PMT-INTEGRATIONTEST00000',
      created_at: '2026-03-01T00:00:00.000Z',
      grpHdr: { msgId: 'MSG-TEST', creDtTm: '2026-03-01T00:00:00.000Z' },
      pmtId: { endToEndId: 'E2E-TEST' },
      amount: { value: 250, currency: 'BRL' },
      fx: { source_currency: 'BRL' },
      origin: { rail: 'PIX' },
      destination: { rail: undefined },
      debtor: { name: 'Alice', country: 'BR', account_id: 'PIX-abc' },
      creditor: { name: 'Bob', country: undefined, account_id: 'SPEI-def' },
      alias: { type: 'PIX_KEY', value: 'abc' },
      purpose: 'P2P',
      reference: 'MIPIT-POC',
      status: 'RECEIVED',
      trace_id: 'trace-int',
    }),
    fromCanonical: jest.fn().mockResolvedValue({ pixKey: 'abc', amount: 250 }),
  };

  const normalizer = {
    normalize: jest.fn().mockImplementation((c) => Promise.resolve({ ...c, amount: { ...c.amount, currency: 'BRL' } })),
  };

  const routeEngine = {
    resolve: jest.fn().mockResolvedValue({ destination: 'SPEI', ruleName: 'pix-key-to-spei' }),
  };

  const publisher = { publishToAdapter: jest.fn().mockResolvedValue(undefined) };

  const createdPayments = new Map<string, any>();
  const paymentRepo = {
    create: jest.fn().mockImplementation((p) => { createdPayments.set(p.payment_id, { ...p }); return Promise.resolve(p); }),
    updateStatus: jest.fn().mockImplementation((id, status) => { const p = createdPayments.get(id); if (p) p.status = status; return Promise.resolve(p); }),
    updateCanonical: jest.fn().mockResolvedValue({}),
    updateRoute: jest.fn().mockResolvedValue({}),
    updateTranslated: jest.fn().mockResolvedValue({}),
  };

  const auditEvents: any[] = [];
  const auditService = {
    log: jest.fn().mockImplementation((...args: any[]) => { auditEvents.push({ type: args[1], actor: args[2] }); return Promise.resolve(); }),
    logRoutingDecision: jest.fn().mockImplementation((...args: any[]) => { auditEvents.push({ type: 'ROUTE_DECISION', dest: args[1] }); return Promise.resolve(); }),
    logError: jest.fn().mockResolvedValue(undefined),
  };

  const childLog = { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() };
  const logger = { child: jest.fn(() => childLog), info: jest.fn(), error: jest.fn() } as any;

  return { translator, normalizer, routeEngine, publisher, paymentRepo, auditService, logger, createdPayments, auditEvents };
}

function buildPixRequest() {
  return {
    amount: 250,
    currency: 'BRL',
    debtor: { alias: 'PIX-abc123', name: 'Alice' },
    creditor: { alias: 'SPEI-def456', name: 'Bob' },
    purpose: 'P2P',
    reference: 'REF-INT',
  } as any;
}

describe('PaymentPipeline (integration)', () => {
  it('should execute the full 7-step pipeline for a PIX→SPEI payment', async () => {
    const m = buildFullMocks();
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    const result = await pipeline.execute(buildPixRequest(), { traceId: 'trace-int' });

    expect(result.payment_id).toMatch(/^PMT-/);
    expect(result.status).toBe(PAYMENT_STATUS.QUEUED);
    expect(result.destination_rail).toBe('SPEI');
  });

  it('should execute the full pipeline for a SPEI→PIX payment', async () => {
    const m = buildFullMocks();
    m.translator.toCanonical.mockResolvedValue({
      payment_id: 'PMT-INTEGRATIONTEST00000',
      created_at: '2026-03-01T00:00:00.000Z',
      grpHdr: { msgId: 'MSG-TEST2', creDtTm: '2026-03-01T00:00:00.000Z' },
      pmtId: { endToEndId: 'E2E-TEST2' },
      amount: { value: 500, currency: 'MXN' },
      fx: { source_currency: 'MXN' },
      origin: { rail: 'SPEI' },
      destination: { rail: undefined },
      debtor: { name: 'Carlos', country: 'MX', account_id: 'SPEI-xyz' },
      creditor: { name: 'Diana', country: undefined, account_id: 'PIX-uvw' },
      alias: { type: 'CLABE', value: 'xyz' },
      purpose: 'P2P',
      reference: 'MIPIT-POC',
      status: 'RECEIVED',
    });
    m.routeEngine.resolve.mockResolvedValue({ destination: 'PIX', ruleName: 'clabe-to-pix' });

    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    const result = await pipeline.execute(
      { amount: 500, currency: 'MXN', debtor: { alias: 'SPEI-xyz', name: 'Carlos' }, creditor: { alias: 'PIX-uvw', name: 'Diana' } } as any,
      {},
    );

    expect(result.destination_rail).toBe('PIX');
  });

  it('should persist payment with RECEIVED status on step 2', async () => {
    const m = buildFullMocks();
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    await pipeline.execute(buildPixRequest(), {});

    expect(m.paymentRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      status: PAYMENT_STATUS.RECEIVED,
      origin_rail: 'PIX',
    }));
  });

  it('should update canonical payload after translation (step 4)', async () => {
    const m = buildFullMocks();
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    await pipeline.execute(buildPixRequest(), {});

    expect(m.paymentRepo.updateCanonical).toHaveBeenCalledWith(
      expect.stringMatching(/^PMT-/),
      expect.objectContaining({ amount: { value: 250, currency: 'BRL' } }),
      PAYMENT_STATUS.CANONICALIZED,
    );
  });

  it('should update route and destination after routing (step 6)', async () => {
    const m = buildFullMocks();
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    await pipeline.execute(buildPixRequest(), {});

    expect(m.paymentRepo.updateRoute).toHaveBeenCalledWith(
      expect.stringMatching(/^PMT-/), 'SPEI', 'pix-key-to-spei', PAYMENT_STATUS.ROUTED,
    );
  });

  it('should publish message to RabbitMQ and set QUEUED status (step 7)', async () => {
    const m = buildFullMocks();
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    await pipeline.execute(buildPixRequest(), {});

    expect(m.publisher.publishToAdapter).toHaveBeenCalledWith('SPEI', expect.objectContaining({ destination_rail: 'SPEI' }));
    expect(m.paymentRepo.updateStatus).toHaveBeenCalledWith(expect.any(String), PAYMENT_STATUS.QUEUED);
  });

  it('should throw on unknown rail alias prefix', async () => {
    const m = buildFullMocks();
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    await expect(
      pipeline.execute({ amount: 100, debtor: { alias: 'WIRE-xxx', name: 'Z' }, creditor: { alias: 'PIX-abc', name: 'Y' } } as any, {}),
    ).rejects.toThrow('Cannot infer rail from alias');
  });

  it('should set status FAILED and log error when translator throws', async () => {
    const m = buildFullMocks();
    m.translator.toCanonical.mockRejectedValue(new Error('Translation failed'));
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    await expect(pipeline.execute(buildPixRequest(), {})).rejects.toThrow('Translation failed');

    expect(m.paymentRepo.updateStatus).toHaveBeenCalledWith(expect.any(String), PAYMENT_STATUS.FAILED);
    expect(m.auditService.logError).toHaveBeenCalledTimes(1);
  });

  it('should register audit events for each pipeline step', async () => {
    const m = buildFullMocks();
    const pipeline = new PaymentPipeline(
      m.translator as any, m.normalizer as any, m.routeEngine as any,
      m.publisher as any, m.paymentRepo as any, m.auditService as any, m.logger,
    );

    await pipeline.execute(buildPixRequest(), {});

    expect(m.auditEvents.length).toBeGreaterThanOrEqual(5);
    const types = m.auditEvents.map((e) => e.type);
    expect(types).toContain('PAYMENT_RECEIVED');
    expect(types).toContain('PAYMENT_VALIDATED');
    expect(types).toContain('CANONICAL_UPDATED');
    expect(types).toContain('ROUTE_DECISION');
    expect(types).toContain('STATUS_CHANGE');
  });
});
