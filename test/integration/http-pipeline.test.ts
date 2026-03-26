import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { paymentRoutes } from '../../src/api/routes/payments';
import { healthRoutes } from '../../src/api/routes/health';
import { tracingMiddleware } from '../../src/api/middleware/tracing';
import { authMiddleware } from '../../src/api/middleware/auth';
import { errorHandler } from '../../src/api/middleware/error-handler';

jest.mock('../../src/observability/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

jest.mock('../../src/observability/metrics', () => ({
  startLatencyTimer: jest.fn(() => jest.fn()),
  recordPayment: jest.fn(),
  recordTranslationError: jest.fn(),
  recordRoutingDecision: jest.fn(),
  registry: { metrics: jest.fn().mockResolvedValue(''), contentType: 'text/plain' },
}));

const JWT_SECRET = 'test-secret-key-minimum-16-chars';

const validPayload = {
  amount: 100,
  currency: 'BRL',
  debtor: { alias: 'PIX-chave-123', name: 'Sender' },
  creditor: { alias: 'SPEI-123456789012345678', name: 'Receiver' },
};

const mockPipeline = {
  execute: jest.fn().mockResolvedValue({
    payment_id: 'PMT-TEST-001',
    status: 'QUEUED',
    created_at: '2026-03-01T12:00:00.000Z',
    destination_rail: 'SPEI',
  }),
};

const mockPaymentRepo = {
  findById: jest.fn(),
  create: jest.fn(),
  updateStatus: jest.fn(),
};

const mockAuditRepo = {
  findByPaymentId: jest.fn().mockResolvedValue([
    {
      id: 'AUD-001',
      event_type: 'PAYMENT_RECEIVED',
      actor: 'system',
      detail: { origin_rail: 'PIX' },
      trace_id: 'trace-1',
      created_at: '2026-03-01T12:00:00.000Z',
    },
  ]),
};

const mockIdempotencyRepo = {
  findByKey: jest.fn().mockResolvedValue(null),
  insert: jest.fn(),
  updateResponse: jest.fn(),
};

const mockAuditService = {
  log: jest.fn(),
  logStatusChange: jest.fn(),
  logRoutingDecision: jest.fn(),
  logError: jest.fn(),
  logAckReceived: jest.fn(),
};

async function buildTestServer() {
  const app = Fastify({ logger: false });

  await app.register(fastifyJwt, { secret: JWT_SECRET });

  app.addHook('onRequest', tracingMiddleware);
  app.setErrorHandler(errorHandler);

  await app.register(healthRoutes);

  await app.register(async (scoped) => {
    scoped.addHook('onRequest', authMiddleware);
    await paymentRoutes(scoped, {
      db: {} as any,
      channel: {} as any,
      jwtSecret: JWT_SECRET,
      pipeline: mockPipeline as any,
      paymentRepo: mockPaymentRepo as any,
      auditRepo: mockAuditRepo as any,
      idempotencyRepo: mockIdempotencyRepo as any,
      auditService: mockAuditService as any,
    });
  });

  return app;
}

describe('HTTP → Pipeline Integration', () => {
  let app: Awaited<ReturnType<typeof buildTestServer>>;
  let token: string;

  beforeAll(async () => {
    app = await buildTestServer();
    await app.ready();
    token = app.jwt.sign({ sub: 'test-client', role: 'admin' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPipeline.execute.mockResolvedValue({
      payment_id: 'PMT-TEST-001',
      status: 'QUEUED',
      created_at: '2026-03-01T12:00:00.000Z',
      destination_rail: 'SPEI',
    });
    mockIdempotencyRepo.findByKey.mockResolvedValue(null);
  });

  describe('POST /payments', () => {
    it('should return 201 with payment details when authenticated', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/payments',
        headers: {
          authorization: `Bearer ${token}`,
          'idempotency-key': 'idem-001',
        },
        payload: validPayload,
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.payment_id).toBe('PMT-TEST-001');
      expect(body.status).toBe('QUEUED');
      expect(body.destination_rail).toBe('SPEI');
    });

    it('should call pipeline.execute with parsed body', async () => {
      await app.inject({
        method: 'POST',
        url: '/payments',
        headers: {
          authorization: `Bearer ${token}`,
          'idempotency-key': 'idem-002',
        },
        payload: validPayload,
      });

      expect(mockPipeline.execute).toHaveBeenCalledTimes(1);
      const [body, context] = mockPipeline.execute.mock.calls[0];
      expect(body.amount).toBe(100);
      expect(body.debtor.alias).toBe('PIX-chave-123');
      expect(context.idempotencyKey).toBe('idem-002');
      expect(context.traceId).toBeDefined();
    });

    it('should return 401 without JWT token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/payments',
        payload: validPayload,
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 with invalid JWT', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/payments',
        headers: { authorization: 'Bearer invalid-token-here' },
        payload: validPayload,
      });

      expect(res.statusCode).toBe(401);
    });

    it('should return 400 with invalid payload', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/payments',
        headers: { authorization: `Bearer ${token}` },
        payload: { amount: -5 },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should include X-Trace-ID in response headers', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/payments',
        headers: {
          authorization: `Bearer ${token}`,
          'x-trace-id': 'custom-trace-123',
        },
        payload: validPayload,
      });

      expect(res.headers['x-trace-id']).toBe('custom-trace-123');
    });

    it('should generate X-Trace-ID when not provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/payments',
        headers: { authorization: `Bearer ${token}` },
        payload: validPayload,
      });

      expect(res.headers['x-trace-id']).toBeDefined();
      expect((res.headers['x-trace-id'] as string).length).toBeGreaterThan(0);
    });

    it('should store idempotency record after successful processing', async () => {
      await app.inject({
        method: 'POST',
        url: '/payments',
        headers: {
          authorization: `Bearer ${token}`,
          'idempotency-key': 'idem-store',
        },
        payload: validPayload,
      });

      expect(mockIdempotencyRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotency_key: 'idem-store',
          payment_id: 'PMT-TEST-001',
          response_status: 201,
        }),
      );
    });

    it('should return cached response for duplicate idempotency key', async () => {
      const crypto = require('node:crypto');
      const hash = crypto.createHash('sha256').update(JSON.stringify(validPayload)).digest('hex');

      mockIdempotencyRepo.findByKey.mockResolvedValue({
        idempotency_key: 'idem-dup',
        request_hash: hash,
        response_status: 201,
        response_body: { payment_id: 'PMT-CACHED', status: 'QUEUED' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/payments',
        headers: {
          authorization: `Bearer ${token}`,
          'idempotency-key': 'idem-dup',
        },
        payload: validPayload,
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.payment_id).toBe('PMT-CACHED');
      expect(mockPipeline.execute).not.toHaveBeenCalled();
    });
  });

  describe('GET /payments/:paymentId', () => {
    it('should return payment detail with audit trail', async () => {
      mockPaymentRepo.findById.mockResolvedValue({
        payment_id: 'PMT-GET-001',
        status: 'COMPLETED',
        origin_rail: 'PIX',
        destination_rail: 'SPEI',
        amount: 100,
        currency: 'BRL',
        debtor_alias: 'PIX-chave-123',
        debtor_name: 'Sender',
        creditor_alias: 'SPEI-123456789012345678',
        creditor_name: 'Receiver',
        purpose: 'P2P',
        reference: 'MIPIT-POC',
        origin_payload: validPayload,
        canonical_payload: null,
        translated_payload: null,
        rail_ack: null,
        route_rule_applied: null,
        trace_id: 'trace-get',
        created_at: '2026-03-01T12:00:00.000Z',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/payments/PMT-GET-001',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.payment_id).toBe('PMT-GET-001');
      expect(body.status).toBe('COMPLETED');
      expect(body.origin_rail).toBe('PIX');
      expect(body.audit_trail).toHaveLength(1);
      expect(body.audit_trail[0].event_type).toBe('PAYMENT_RECEIVED');
    });

    it('should return 404 for non-existent payment', async () => {
      mockPaymentRepo.findById.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/payments/PMT-NONEXISTENT',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('NOT_FOUND');
    });

    it('should require authentication for GET', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/payments/PMT-GET-001',
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /health (no auth required)', () => {
    it('should return 200 without JWT', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('ok');
    });
  });
});
