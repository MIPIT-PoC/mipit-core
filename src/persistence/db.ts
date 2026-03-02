import { Pool } from 'pg';
import { logger } from '../observability/logger.js';

let pool: Pool | null = null;

export async function connectDb(connectionString: string): Promise<Pool> {
  pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  const client = await pool.connect();
  client.release();
  logger.info('PostgreSQL connected');

  return pool;
}

export function getPool(): Pool {
  if (!pool) throw new Error('Database pool not initialized');
  return pool;
}
