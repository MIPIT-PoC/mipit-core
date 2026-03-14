import { Pool } from 'pg';
import { logger } from '../observability/logger.js';

let pool: Pool | null = null;

export async function connectDb(connectionString: string): Promise<Pool> {
  try {
    pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
    });

    await pool.query('SELECT 1');
    logger.info('PostgreSQL connected');

    return pool;
  } catch (err) {
    logger.error({ err }, 'Failed to connect to PostgreSQL');
    pool = null;
    throw err;
  }
}

export function getPool(): Pool {
  if (!pool) throw new Error('Database pool not initialized');
  return pool;
}

export async function disconnectDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('PostgreSQL disconnected');
  }
}
