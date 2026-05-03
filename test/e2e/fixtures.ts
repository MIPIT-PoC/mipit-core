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
export async function getJWTToken(): Promise<string> {
  if (jwtToken) return jwtToken;

  const http = await import('http');
  const port = parseInt(process.env.PORT || '8080', 10);

  return new Promise<string>((resolve, reject) => {
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
          } else {
            reject(new Error(`Cannot get JWT token: ${res.statusCode} ${data}`));
          }
        } catch {
          reject(new Error(`Cannot parse JWT response: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Failed to get JWT token: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('JWT token request timeout'));
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
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/mipit_test';

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
    await dbPool.query(
      `DELETE FROM payments 
       WHERE reference LIKE $1 
          OR trace_id LIKE $2`,
      [`%e2e-test-${testTag}-%`, `e2e-test-${testTag}-%`]
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
export async function makePaymentRequest(
  payload: any
): Promise<{ status: number; body: any }> {
  const http = await import('http');
  const token = await getJWTToken();
  const port = parseInt(process.env.PORT || '8080', 10);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port,
      path: '/payments',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
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
  predicate?: (msg: any) => boolean
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
      { noAck: false }
    );
  });
}

/**
 * Assert payment status in database
 */
export async function assertPaymentStatus(
  paymentId: string,
  expectedStatus: string
): Promise<any> {
  if (!dbPool) {
    throw new Error('Database not initialized');
  }

  const result = await dbPool.query(
    `SELECT payment_id, status, amount, currency, trace_id, created_at
     FROM payments
     WHERE payment_id = $1`,
    [paymentId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Payment not found: ${paymentId}`);
  }

  const payment = result.rows[0];

  if (payment.status !== expectedStatus) {
    throw new Error(
      `Payment status mismatch. Expected: ${expectedStatus}, Got: ${payment.status}`
    );
  }

  return payment;
}

/**
 * Create test payment request
 */
export function createTestPayment(
  scenario: 'pix' | 'spei' | 'crossrail'
): any {
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