import { Pool } from 'pg';
import * as amqp from 'amqplib';

/**
 * Shared E2E Test Fixtures
 *
 * These fixtures set up real integration with:
 * - PostgreSQL persistence
 * - RabbitMQ messaging
 * - HTTP API routing
 */

let dbPool: Pool;
let rmqConnection: amqp.Connection | null = null;
let rmqChannel: amqp.Channel | null = null;
let jwtToken: string | null = null;

/**
 * Get JWT token from API
 */
export async function getJWTToken(): Promise<string | null> {
  if (jwtToken) return jwtToken;

  const http = await import('http');
  const port = parseInt(process.env.PORT || '8080', 10);

  return new Promise<string | null>((resolve) => {
    const options = {
      hostname: 'localhost',
      port,
      path: '/auth/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const body = JSON.parse(data);

          if (res.statusCode === 200 && body.access_token) {
            jwtToken = body.access_token as string;
            resolve(jwtToken);
            return;
          }

          console.warn(`Auth token unavailable: ${res.statusCode} ${data}`);
          resolve(null);
        } catch {
          console.warn(`Auth token response could not be parsed: ${data}`);
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.write('{}');
    req.end();
  });
}

/**
 * Initialize database connection
 */
export async function setupDatabase(): Promise<Pool> {
  const connectionString =
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/mipit_test';

  dbPool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  try {
    const client = await dbPool.connect();
    await client.query('SELECT NOW()');
    client.release();
    console.log('✓ Database connected');
  } catch (error) {
    throw new Error(`Cannot connect to database: ${error}`);
  }

  return dbPool;
}

/**
 * Initialize RabbitMQ connection
 */
export async function setupRabbitMQ(): Promise<{
  connection: amqp.Connection;
  channel: amqp.Channel;
}> {
  const rmqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

  try {
    rmqConnection = (await amqp.connect(rmqUrl)) as unknown as amqp.Connection;
    rmqChannel = (await (rmqConnection as any).createChannel()) as unknown as amqp.Channel;

    await rmqChannel.assertQueue('payment-acks', { durable: true });

    console.log('✓ RabbitMQ connected');
  } catch (error) {
    throw new Error(`Cannot connect to RabbitMQ: ${error}`);
  }

  return {
    connection: rmqConnection as amqp.Connection,
    channel: rmqChannel as amqp.Channel,
  };
}

/**
 * Clean up database remove test payments
 */
export async function cleanupDatabase(testTag: string): Promise<void> {
  if (!dbPool) return;

  try {
    const referencePattern = `%e2e-test-${testTag}-%`;
    const tracePattern = `e2e-test-${testTag}-%`;

    await dbPool.query(
      `
      DELETE FROM audit_events
      WHERE payment_id IN (
        SELECT payment_id
        FROM payments
        WHERE reference LIKE $1
           OR trace_id LIKE $2
           OR purpose LIKE $3
      )
      `,
      [referencePattern, tracePattern, `%${testTag}%`],
    );

    await dbPool.query(
      `
      DELETE FROM payments
      WHERE reference LIKE $1
         OR trace_id LIKE $2
         OR purpose LIKE $3
      `,
      [referencePattern, tracePattern, `%${testTag}%`],
    );

    console.log(`✓ Cleaned up test payments for: ${testTag}`);
  } catch (error) {
    console.warn(`Warning: Could not cleanup database: ${error}`);
  }
}

/**
 * Tear down connections
 */
export async function teardown(): Promise<void> {
  if (rmqChannel) {
    try {
      await rmqChannel.close();
    } catch {
      // ignore
    }
  }

  if (rmqConnection) {
    try {
      await (rmqConnection as any).close();
    } catch {
      // ignore
    }
  }

  if (dbPool) {
    try {
      await dbPool.end();
    } catch {
      // ignore
    }
  }
}

/**
 * Make HTTP request to API using built-in http module
 */
export async function makePaymentRequest(payload: any): Promise<{ status: number; body: any }> {
  const http = await import('http');
  const token = await getJWTToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const port = parseInt(process.env.PORT || '8080', 10);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port,
      path: '/payments',
      method: 'POST',
      headers,
      timeout: 10000,
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const body = JSON.parse(data);
          resolve({ status: res.statusCode || 500, body });
        } catch {
          resolve({
            status: res.statusCode || 500,
            body: { error: data },
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`HTTP request failed: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('HTTP request timeout'));
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

/**
 * Poll RabbitMQ for message
 */
export async function waitForMessage(
  queueName: string,
  timeoutMs: number = 5000,
  predicate?: (msg: any) => boolean,
): Promise<any> {
  if (!rmqChannel) {
    throw new Error('RabbitMQ not initialized');
  }

  return new Promise((resolve, reject) => {
    let timeout: NodeJS.Timeout;
    const messages: amqp.Message[] = [];

    timeout = setTimeout(() => {
      if (messages.length > 0) {
        rmqChannel!.nack(messages[messages.length - 1], false);
      }

      reject(new Error(`No message received in ${timeoutMs}ms`));
    }, timeoutMs);

    rmqChannel!.consume(
      queueName,
      async (msg) => {
        if (!msg) return;

        try {
          const content = JSON.parse(msg.content.toString());
          messages.push(msg);

          if (!predicate || predicate(content)) {
            clearTimeout(timeout);
            await rmqChannel!.ack(msg);
            resolve(content);
          }
        } catch (error) {
          await rmqChannel!.nack(msg, true);
          reject(error);
        }
      },
      { noAck: false },
    );
  });
}

/**
 * Assert payment status in database
 */
export async function assertPaymentStatus(paymentId: string, expectedStatus: string): Promise<any> {
  if (!dbPool) {
    throw new Error('Database not initialized');
  }

  const result = await dbPool.query(
    `
    SELECT *
    FROM payments
    WHERE payment_id = $1
    `,
    [paymentId],
  );

  if (result.rows.length === 0) {
    throw new Error(`Payment not found: ${paymentId}`);
  }

  const payment = result.rows[0];

  if (payment.status !== expectedStatus) {
    throw new Error(`Payment status mismatch. Expected: ${expectedStatus}, Got: ${payment.status}`);
  }

  return payment;
}

/**
 * Create test payment request
 */
export function createTestPayment(scenario: 'pix' | 'spei' | 'crossrail'): any {
  const traceId = `e2e-test-${scenario}-${Date.now()}`;

  switch (scenario) {
    case 'pix':
      return {
        amount: 100,
        currency: 'BRL',
        debtor: {
          alias: 'PIX-test-debtor-001',
          name: 'Test Debtor BR',
        },
        creditor: {
          alias: 'PIX-test-creditor-001',
          name: 'Test Creditor BR',
        },
        purpose: 'test-pix-happy-path',
        reference: `REF-${traceId}`,
      };

    case 'spei':
      return {
        amount: 500,
        currency: 'MXN',
        debtor: {
          alias: 'SPEI-032180000118359719',
          name: 'Test Debtor MX',
        },
        creditor: {
          alias: 'SPEI-032180000118359719',
          name: 'Test Creditor MX',
        },
        purpose: 'test-spei-happy-path',
        reference: `REF-${traceId}`,
      };

    case 'crossrail':
      return {
        amount: 50,
        currency: 'BRL',
        debtor: {
          alias: 'PIX-test-debtor-002',
          name: 'Test Debtor BR-MX',
        },
        creditor: {
          alias: 'SPEI-032180000118359719',
          name: 'Test Creditor BR-MX',
        },
        purpose: 'test-crossrail-happy-path',
        reference: `REF-${traceId}`,
      };

    default:
      throw new Error(`Unknown scenario: ${scenario}`);
  }
}

/**
 * Get database query result
 */
export async function query(sql: string, params?: any[]): Promise<any> {
  if (!dbPool) {
    throw new Error('Database not initialized');
  }

  return dbPool.query(sql, params);
}

export { dbPool, rmqConnection, rmqChannel };
/**
 * Helper: Force PIX mock to reject the next payment
 */
export async function forcePixRejectNext(): Promise<void> {
  const pixUrl = process.env.PIX_SPI_URL || 'http://localhost:8001';
  const res = await fetch(`${pixUrl}/admin/reject-next`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to force PIX rejection: ${res.statusText}`);
}

/**
 * Helper: Force PIX mock to timeout the next payment
 */
export async function forcePixTimeoutNext(): Promise<void> {
  const pixUrl = process.env.PIX_SPI_URL || 'http://localhost:8001';
  const res = await fetch(`${pixUrl}/admin/timeout-next`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to force PIX timeout: ${res.statusText}`);
}

/**
 * Helper: Force SPEI mock to reject the next payment
 */
export async function forceSpeiRejectNext(): Promise<void> {
  const speiUrl = process.env.SPEI_CECOBAN_URL || 'http://localhost:8002';
  const res = await fetch(`${speiUrl}/admin/reject-next`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to force SPEI rejection: ${res.statusText}`);
}

/**
 * Helper: Force SPEI mock to timeout the next payment
 */
export async function forceSpeiTimeoutNext(): Promise<void> {
  const speiUrl = process.env.SPEI_CECOBAN_URL || 'http://localhost:8002';
  const res = await fetch(`${speiUrl}/admin/timeout-next`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to force SPEI timeout: ${res.statusText}`);
}

/**
 * Helper: Reset mock configuration
 */
export async function resetMockConfig(rail: 'PIX' | 'SPEI'): Promise<void> {
  const url =
    rail === 'PIX'
      ? `${process.env.PIX_SPI_URL || 'http://localhost:8001'}/admin/reset`
      : `${process.env.SPEI_CECOBAN_URL || 'http://localhost:8002'}/admin/reset`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to reset ${rail} mock: ${res.statusText}`);
}

/**
 * Helper: Wait for payment status to eventually reach expected value
 */
export async function waitForPaymentStatus(
  paymentId: string,
  expectedStatus: string,
  maxWaitMs: number = 15000,
): Promise<any> {
  if (!dbPool) throw new Error('Database not initialized');

  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const result = await dbPool.query(`SELECT * FROM payments WHERE payment_id = $1`, [paymentId]);

    if (result.rows.length > 0 && result.rows[0].status === expectedStatus) {
      return result.rows[0];
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(`Timeout waiting for payment ${paymentId} to reach status ${expectedStatus}`);
}

/**
 * Helper: Get audit events for a payment
 */
export async function getAuditEvents(paymentId: string): Promise<any[]> {
  if (!dbPool) throw new Error('Database not initialized');

  const result = await dbPool.query(
    `SELECT * FROM audit_events WHERE payment_id = $1 ORDER BY created_at ASC`,
    [paymentId],
  );

  return result.rows;
}

/**
 * Helper: Get full payment details
 */
export async function getPaymentDetails(paymentId: string): Promise<any> {
  if (!dbPool) throw new Error('Database not initialized');

  const result = await dbPool.query(`SELECT * FROM payments WHERE payment_id = $1`, [paymentId]);

  if (result.rows.length === 0) throw new Error(`Payment not found: ${paymentId}`);
  return result.rows[0];
}

/**
 * Helper: Make payment request with custom idempotency key
 */
export async function makePaymentRequestWithIdempotency(
  payload: any,
  idempotencyKey: string,
): Promise<{ status: number; body: any }> {
  const http = await import('http');
  const token = await getJWTToken();
  const port = parseInt(process.env.PORT || '8080', 10);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path: '/payments',
        method: 'POST',
        headers,
        timeout: 10000,
      },
      (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode || 500,
              body: JSON.parse(data),
            });
          } catch {
            resolve({
              status: res.statusCode || 500,
              body: { error: data },
            });
          }
        });
      },
    );

    req.on('error', (error) => {
      reject(new Error(`HTTP request failed: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('HTTP request timeout'));
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

/**
 * Helper: Check if payment exists
 */
export async function paymentExists(paymentId: string): Promise<boolean> {
  if (!dbPool) return false;
  const result = await dbPool.query(`SELECT 1 FROM payments WHERE payment_id = $1`, [paymentId]);
  return result.rows.length > 0;
}
