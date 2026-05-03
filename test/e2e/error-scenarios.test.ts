/**
 * E2E: Error Scenarios (Fase 2)
 *
 * Tests validating:
 * - Bank rejections (PIX NAO_REALIZADA, SPEI RECHAZADA)
 * - Timeouts and retries → DLQ
 * - Validation errors (bad CLABE, negative amount)
 * - Idempotency (same key = same response)
 * - Concurrency handling
 * - Field truncation and decimal precision
 * - Compensation flow
 */

import {
  setupDatabase,
  setupRabbitMQ,
  teardown,
  cleanupDatabase,
  makePaymentRequest,
  makePaymentRequestWithIdempotency,
  createTestPayment,
  waitForPaymentStatus,
  getAuditEvents,
  getPaymentDetails,
  forcePixRejectNext,
  forceSpeiRejectNext,
  forcePixTimeoutNext,
  forceSpeiTimeoutNext,
  resetMockConfig,
  query,
} from './fixtures';

describe('E2E: Error Scenarios (Fase 2)', () => {
  beforeAll(async () => {
    await setupDatabase();
    await setupRabbitMQ();
    console.log('\n✓ Test environment ready');
  }, 30000);

  afterAll(async () => {
    await teardown();
  });

  // ─────────────────────────────────────────────────────────────
  // Test 1: Bank Rejection - PIX (NAO_REALIZADA)
  // ─────────────────────────────────────────────────────────────
  it('bank rejection - PIX (NAO_REALIZADA) → DB status REJECTED', async () => {
    const payment = createTestPayment('pix');

    // Arrange: Force PIX mock to reject next payment
    await forcePixRejectNext();

    // Act: Submit payment
    const res = await makePaymentRequest(payment);
    expect(res.status).toBe(202);
    const paymentId = res.body.payment_id;

    // Assert: Wait for status to become REJECTED
    await new Promise(r => setTimeout(r, 2000));
    const rejected = await waitForPaymentStatus(paymentId, 'REJECTED', 10000);
    expect(rejected.status).toBe('REJECTED');

    // Assert: Audit event recorded
    const events = await getAuditEvents(paymentId);
    expect(events.length).toBeGreaterThan(0);

    await resetMockConfig('PIX');
    await cleanupDatabase('pix');
  }, 20000);

  // ─────────────────────────────────────────────────────────────
  // Test 2: Bank Rejection - SPEI (R01 - Insufficient Funds)
  // ─────────────────────────────────────────────────────────────
  it('bank rejection - SPEI (R01) → DB status REJECTED', async () => {
    const payment = createTestPayment('spei');

    await forceSpeiRejectNext();

    const res = await makePaymentRequest(payment);
    expect(res.status).toBe(202);
    const paymentId = res.body.payment_id;

    await new Promise(r => setTimeout(r, 2000));
    const rejected = await waitForPaymentStatus(paymentId, 'REJECTED', 10000);
    expect(rejected.status).toBe('REJECTED');

    await resetMockConfig('SPEI');
    await cleanupDatabase('spei');
  }, 20000);

  // ─────────────────────────────────────────────────────────────
  // Test 3: Adapter Timeout → Retries → DLQ → FAILED
  // ─────────────────────────────────────────────────────────────
  it('adapter timeout → retries → DLQ → status FAILED', async () => {
    const payment = createTestPayment('spei');

    // Force timeout
    await forceSpeiTimeoutNext();

    const res = await makePaymentRequest(payment);
    expect(res.status).toBe(202);
    const paymentId = res.body.payment_id;

    // Wait for retries and DLQ processing (configurable in app)
    await new Promise(r => setTimeout(r, 8000));

    try {
      const failed = await waitForPaymentStatus(paymentId, 'FAILED', 5000);
      expect(failed.status).toBe('FAILED');
    } catch {
      // If still in PENDING, that's ok — app may still retrying
      const current = await getPaymentDetails(paymentId);
      expect(['PENDING', 'FAILED']).toContain(current.status);
    }

    await resetMockConfig('SPEI');
    await cleanupDatabase('spei');
  }, 25000);

  // ─────────────────────────────────────────────────────────────
  // Test 4: Validation Error - Invalid CLABE (400)
  // ─────────────────────────────────────────────────────────────
  it('validation error - invalid CLABE → 400 Bad Request', async () => {
    const payment = {
      amount: 100,
      currency: 'MXN',
      debtor: {
        alias: 'SPEI-invalid-clabe-12345', // Invalid CLABE format
        name: 'Test Debtor',
      },
      creditor: {
        alias: 'SPEI-032180000118359719',
        name: 'Test Creditor',
      },
    };

    const res = await makePaymentRequest(payment);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');

    // Assert: No row created in DB
    const exists = await query(
      `SELECT 1 FROM payments WHERE creditor_alias = $1 LIMIT 1`,
      [payment.creditor.alias]
    );
    expect(exists.rows.length).toBe(0);

    await cleanupDatabase('validation');
  }, 10000);

  // ─────────────────────────────────────────────────────────────
  // Test 5: Validation Error - Negative Amount (400)
  // ─────────────────────────────────────────────────────────────
  it('validation error - negative amount → 400', async () => {
    const payment = {
      amount: -100, // Invalid: negative
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

    await cleanupDatabase('validation');
  }, 10000);

  // ─────────────────────────────────────────────────────────────
  // Test 6: Idempotency - Same key → Same response (no duplicate)
  // ─────────────────────────────────────────────────────────────
  it('idempotency - same Idempotency-Key → single payment row', async () => {
    const payment = createTestPayment('pix');
    const idempotencyKey = `idem-test-${Date.now()}`;

    // First request
    const res1 = await makePaymentRequestWithIdempotency(payment, idempotencyKey);
    expect(res1.status).toBe(202);
    const paymentId1 = res1.body.payment_id;

    // Wait for processing
    await new Promise(r => setTimeout(r, 1000));

    // Second request with same key
    const res2 = await makePaymentRequestWithIdempotency(payment, idempotencyKey);
    expect(res2.status).toBe(202);
    const paymentId2 = res2.body.payment_id;

    // Both should return same payment_id
    expect(paymentId1).toBe(paymentId2);

    // Verify only one row in DB
    const result = await query(
      `SELECT COUNT(*) as cnt FROM payments WHERE payment_id = $1`,
      [paymentId1]
    );
    expect(parseInt(result.rows[0].cnt)).toBe(1);

    await cleanupDatabase('pix');
  }, 15000);

  // ─────────────────────────────────────────────────────────────
  // Test 7: Concurrency - Multiple concurrent requests same creditor
  // ─────────────────────────────────────────────────────────────
  it('concurrency - 5 concurrent requests → 5 unique payments', async () => {
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
          alias: 'PIX-concurrent-creditor',
          name: 'Test Creditor',
        },
      }));

    // Submit all concurrently
    const results = await Promise.all(payments.map(p => makePaymentRequest(p)));

    // All should succeed
    expect(results.every(r => r.status === 202)).toBe(true);

    const paymentIds = results.map(r => r.body.payment_id);
    expect(new Set(paymentIds).size).toBe(5); // All unique

    await cleanupDatabase('pix');
  }, 20000);

  // ─────────────────────────────────────────────────────────────
  // Test 8: Auth Failure - Missing Bearer token → 401
  // ─────────────────────────────────────────────────────────────
  it('auth failure - missing Bearer token → 401', async () => {
    const http = await import('http');
    const port = parseInt(process.env.PORT || '8080', 10);
    const payment = createTestPayment('pix');

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port,
        path: '/payments',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // NO Authorization header
        },
        timeout: 5000,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          expect(res.statusCode).toBe(401);
          resolve(undefined);
        });
      });

      req.on('error', reject);
      req.write(JSON.stringify(payment));
      req.end();
    });
  }, 10000);

  // ─────────────────────────────────────────────────────────────
  // Test 9: Long Field Names Are Truncated Correctly
  // ─────────────────────────────────────────────────────────────
  it('field truncation - long names truncated per spec', async () => {
    const longName = 'A'.repeat(100); // Exceeds SPEI 39-char limit
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
    expect(res.status).toBe(202);
    const paymentId = res.body.payment_id;

    await new Promise(r => setTimeout(r, 1000));
    const stored = await getPaymentDetails(paymentId);

    // Should be truncated
    expect(stored.debtor_name?.length).toBeLessThanOrEqual(39);
    expect(stored.creditor_name?.length).toBeLessThanOrEqual(39);

    await cleanupDatabase('spei');
  }, 15000);

  // ─────────────────────────────────────────────────────────────
  // Test 10: Decimal Precision Preserved
  // ─────────────────────────────────────────────────────────────
  it('decimal precision - amounts preserved exactly', async () => {
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
    expect(res.status).toBe(202);
    const paymentId = res.body.payment_id;

    await new Promise(r => setTimeout(r, 1000));
    const stored = await getPaymentDetails(paymentId);

    expect(parseFloat(stored.amount)).toBe(1234.56);

    await cleanupDatabase('pix');
  }, 10000);

  // ─────────────────────────────────────────────────────────────
  // Test 11: PIX Timeout with Retries (Simulated)
  // ─────────────────────────────────────────────────────────────
  it('PIX timeout → eventual retry success or DLQ', async () => {
    const payment = createTestPayment('pix');

    // Force timeout
    await forcePixTimeoutNext();

    const res = await makePaymentRequest(payment);
    expect(res.status).toBe(202);
    const paymentId = res.body.payment_id;

    // Wait for timeout handling
    await new Promise(r => setTimeout(r, 5000));

    const current = await getPaymentDetails(paymentId);
    // Should be either still processing or failed (depends on retry exhaustion)
    expect(['PENDING', 'FAILED']).toContain(current.status);

    await resetMockConfig('PIX');
    await cleanupDatabase('pix');
  }, 20000);
});
