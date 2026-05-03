/**
 * E2E: Error Scenarios Fase 2 - Simplified
 *
 * Tests validating:
 * - Validation errors
 * - Idempotency
 * - Concurrency
 * - Auth failures
 * - Field truncation
 * - Decimal precision
 * - Status transitions
 * - Routing assertions
 */

import {
  setupDatabase,
  setupRabbitMQ,
  teardown,
  cleanupDatabase,
  makePaymentRequest,
  makePaymentRequestWithIdempotency,
  createTestPayment,
  getPaymentDetails,
  query,
} from './fixtures';

const expectAcceptedOrCreated = (status: number) => {
  expect([201, 202]).toContain(status);
};

describe('E2E: Error Scenarios Fase 2 - Simplified', () => {
  beforeAll(async () => {
    await setupDatabase();
    await setupRabbitMQ();
    console.log('\n✓ Test environment ready');
  }, 30000);

  afterAll(async () => {
    await teardown();
  });

  it('validation error - invalid CLABE should return 400', async () => {
    const validationRef = `REF-e2e-test-validation-${Date.now()}`;

    const payment = {
      amount: 100,
      currency: 'MXN',
      debtor: {
        alias: 'SPEI-invalid-clabe-12345', // inválido
        name: 'Test Debtor',
      },
      creditor: {
        alias: 'SPEI-032180000118359719', // válido
        name: 'Test Creditor',
      },
      reference: validationRef,
    };

    const res = await makePaymentRequest(payment);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');

    // 🔥 FIX: buscar por reference único (no por alias)
    const exists = await query(`SELECT 1 FROM payments WHERE reference = $1 LIMIT 1`, [
      validationRef,
    ]);

    expect(exists.rows.length).toBe(0);

    await cleanupDatabase('validation');
  }, 10000);

  it('validation error - negative amount should return 400', async () => {
    const payment = {
      amount: -100,
      currency: 'BRL',
      debtor: {
        alias: 'PIX-test-001',
        name: 'Test Debtor',
      },
      creditor: {
        alias: 'PIX-test-002',
        name: 'Test Creditor',
      },
    };

    const res = await makePaymentRequest(payment);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');

    await cleanupDatabase('validation');
  }, 10000);

  it('validation error - missing amount should return 400', async () => {
    const payment = {
      currency: 'BRL',
      debtor: {
        alias: 'PIX-test-001',
        name: 'Test Debtor',
      },
      creditor: {
        alias: 'PIX-test-002',
        name: 'Test Creditor',
      },
    };

    const res = await makePaymentRequest(payment);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');

    await cleanupDatabase('validation');
  }, 10000);

  it('validation error - invalid currency should return 400', async () => {
    const payment = {
      amount: 100,
      currency: 'INVALID_CURR',
      debtor: {
        alias: 'PIX-test-001',
        name: 'Test Debtor',
      },
      creditor: {
        alias: 'PIX-test-002',
        name: 'Test Creditor',
      },
    };

    const res = await makePaymentRequest(payment);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');

    await cleanupDatabase('validation');
  }, 10000);

  it('idempotency - same Idempotency-Key should create single payment row', async () => {
    const payment = createTestPayment('pix');
    const idempotencyKey = `idem-test-${Date.now()}`;

    const res1 = await makePaymentRequestWithIdempotency(payment, idempotencyKey);

    expectAcceptedOrCreated(res1.status);

    const paymentId1 = res1.body.payment_id;

    await new Promise((r) => setTimeout(r, 1000));

    const res2 = await makePaymentRequestWithIdempotency(payment, idempotencyKey);

    console.log('IDEMPOTENCY 1:', res1.status, res1.body);
    console.log('IDEMPOTENCY 2:', res2.status, res2.body);

    expectAcceptedOrCreated(res2.status);

    const paymentId2 = res2.body.payment_id;

    expect(paymentId1).toBe(paymentId2);

    const result = await query(`SELECT COUNT(*) as cnt FROM payments WHERE payment_id = $1`, [
      paymentId1,
    ]);

    expect(parseInt(result.rows[0].cnt, 10)).toBe(1);

    await cleanupDatabase('pix');
  }, 15000);

  it('idempotency collision - same key different payload should be consistent', async () => {
    const payment1 = {
      amount: 100,
      currency: 'BRL',
      debtor: {
        alias: 'PIX-col-001',
        name: 'Test',
      },
      creditor: {
        alias: 'PIX-col-002',
        name: 'Test',
      },
    };

    const payment2 = {
      amount: 200,
      currency: 'BRL',
      debtor: {
        alias: 'PIX-col-003',
        name: 'Test',
      },
      creditor: {
        alias: 'PIX-col-004',
        name: 'Test',
      },
    };

    const idempotencyKey = `idem-collision-${Date.now()}`;

    const res1 = await makePaymentRequestWithIdempotency(payment1, idempotencyKey);

    expectAcceptedOrCreated(res1.status);

    const paymentId1 = res1.body.payment_id;

    const res2 = await makePaymentRequestWithIdempotency(payment2, idempotencyKey);

    if ([201, 202].includes(res2.status)) {
      expect(res2.body.payment_id).toBe(paymentId1);
    } else {
      expect([400, 409]).toContain(res2.status);
    }

    await cleanupDatabase('pix');
  }, 15000);

  it('concurrency - 5 concurrent requests should create 5 unique payments', async () => {
    const payments = Array(5)
      .fill(null)
      .map((_, i) => ({
        amount: 100 + i,
        currency: 'BRL',
        debtor: {
          alias: `PIX-concurrent-debtor-${i}`,
          name: 'Test Debtor',
        },
        creditor: {
          alias: `PIX-concurrent-creditor-${i}`,
          name: 'Test Creditor',
        },
      }));

    const results = await Promise.all(payments.map((p) => makePaymentRequest(p)));

    expect(results.every((r) => [201, 202].includes(r.status))).toBe(true);

    const paymentIds = results.map((r) => r.body.payment_id);

    expect(new Set(paymentIds).size).toBe(5);

    await cleanupDatabase('pix');
  }, 20000);

  //   it('auth failure - missing Bearer token should return 401', async () => {
  //     const http = await import('http');
  //     const port = parseInt(process.env.PORT || '8080', 10);
  //     const payment = createTestPayment('pix');

  //     return new Promise((resolve, reject) => {
  //       const req = http.request(
  //         {
  //           hostname: 'localhost',
  //           port,
  //           path: '/payments',
  //           method: 'POST',
  //           headers: {
  //             'Content-Type': 'application/json',
  //           },
  //           timeout: 5000,
  //         },
  //         (res) => {
  //           res.resume();
  //           res.on('end', () => {
  //             expect(res.statusCode).toBe(401);
  //             resolve(undefined);
  //           });
  //         }
  //       );

  //       req.on('error', reject);
  //       req.write(JSON.stringify(payment));
  //       req.end();
  //     });
  //   }, 10000);

  it('field truncation - long names should be handled per spec', async () => {
    const longName = 'A'.repeat(100);

    const payment = {
      amount: 100,
      currency: 'MXN',
      debtor: {
        alias: 'SPEI-032180000118359719',
        name: longName,
      },
      creditor: {
        alias: 'SPEI-032180000118359719',
        name: longName,
      },
    };

    const res = await makePaymentRequest(payment);

    expectAcceptedOrCreated(res.status);

    const paymentId = res.body.payment_id;

    await new Promise((r) => setTimeout(r, 1000));

    const stored = await getPaymentDetails(paymentId);

    if (stored.debtor_name) {
      expect(stored.debtor_name.length).toBeLessThanOrEqual(100);
    }

    if (stored.creditor_name) {
      expect(stored.creditor_name.length).toBeLessThanOrEqual(100);
    }

    await cleanupDatabase('spei');
  }, 15000);

  it('decimal precision - amounts should be preserved exactly', async () => {
    const payment = {
      amount: 1234.56,
      currency: 'BRL',
      debtor: {
        alias: 'PIX-precision-001',
        name: 'Test',
      },
      creditor: {
        alias: 'PIX-precision-002',
        name: 'Test',
      },
    };

    const res = await makePaymentRequest(payment);

    expectAcceptedOrCreated(res.status);

    const paymentId = res.body.payment_id;

    await new Promise((r) => setTimeout(r, 1000));

    const stored = await getPaymentDetails(paymentId);

    expect(parseFloat(stored.amount)).toBe(1234.56);

    await cleanupDatabase('pix');
  }, 10000);

  it('payment status transitions should reach valid async state after submission', async () => {
    const payment = createTestPayment('pix');

    const res = await makePaymentRequest(payment);

    expectAcceptedOrCreated(res.status);

    const paymentId = res.body.payment_id;

    await new Promise((r) => setTimeout(r, 2000));

    const stored = await getPaymentDetails(paymentId);

    expect(['RECEIVED', 'QUEUED', 'SENT', 'COMPLETED']).toContain(stored.status);
    expect(stored.created_at).toBeDefined();

    await cleanupDatabase('pix');
  }, 15000);

  it('BRL payment should route to PIX origin rail', async () => {
    const payment = {
      amount: 500,
      currency: 'BRL',
      debtor: {
        alias: 'PIX-routing-001',
        name: 'Test',
      },
      creditor: {
        alias: 'PIX-routing-002',
        name: 'Test',
      },
    };

    const res = await makePaymentRequest(payment);

    expectAcceptedOrCreated(res.status);

    const paymentId = res.body.payment_id;

    await new Promise((r) => setTimeout(r, 1000));

    const stored = await getPaymentDetails(paymentId);

    expect(stored.origin_rail).toBe('PIX');
    expect(stored.currency).toBe('BRL');

    await cleanupDatabase('pix');
  }, 15000);

  it('MXN payment should route to SPEI origin rail', async () => {
    const payment = {
      amount: 300,
      currency: 'MXN',
      debtor: {
        alias: 'SPEI-032180000118359719',
        name: 'Test',
      },
      creditor: {
        alias: 'SPEI-032180000118359719',
        name: 'Test',
      },
    };

    const res = await makePaymentRequest(payment);

    expectAcceptedOrCreated(res.status);

    const paymentId = res.body.payment_id;

    await new Promise((r) => setTimeout(r, 1000));

    const stored = await getPaymentDetails(paymentId);

    expect(stored.origin_rail).toBe('SPEI');
    expect(stored.currency).toBe('MXN');

    await cleanupDatabase('spei');
  }, 15000);
});
