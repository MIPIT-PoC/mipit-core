import type { Pool } from 'pg';
import { SQL } from '../queries/index.js';
import { logger } from '../../observability/logger.js';

export interface IdempotencyRecord {
  idempotency_key: string;
  payment_id: string;
  request_hash: string;
  response_status?: number;
  response_body?: unknown;
  created_at: string;
  expires_at?: string;
}

export class IdempotencyRepository {
  constructor(private readonly db: Pool) {}

  async findByKey(key: string): Promise<IdempotencyRecord | null> {
    const result = await this.db.query(SQL.FIND_IDEMPOTENCY_BY_KEY, [key]);
    const record = (result.rows[0] as IdempotencyRecord) ?? null;
    logger.debug({ idempotency_key: key, found: !!record }, 'Idempotency lookup');
    return record;
  }

  async insert(record: IdempotencyRecord, ttlHours = 24): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
    await this.db.query(SQL.INSERT_IDEMPOTENCY, [
      record.idempotency_key,
      record.payment_id,
      record.request_hash,
      record.response_status,
      record.response_body ? JSON.stringify(record.response_body) : null,
      record.created_at,
      expiresAt,
    ]);
    logger.debug({ idempotency_key: record.idempotency_key, payment_id: record.payment_id, expires_at: expiresAt }, 'Idempotency key inserted');
  }

  /**
   * Atomically tries to insert an idempotency record (P01/P06 — TTL fix).
   * Returns true if inserted (this request won the race), false if another request already claimed the key.
   *
   * P01 fix: explicitly writes `expires_at` so `FIND_IDEMPOTENCY_BY_KEY`'s
   * `WHERE expires_at > NOW()` actually filters on a real value (was NULL before).
   */
  async tryInsert(
    record: Pick<IdempotencyRecord, 'idempotency_key' | 'payment_id' | 'request_hash' | 'created_at'>,
    ttlHours = 24,
  ): Promise<boolean> {
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
    const result = await this.db.query(SQL.INSERT_IDEMPOTENCY, [
      record.idempotency_key,
      record.payment_id,
      record.request_hash,
      null,
      null,
      record.created_at,
      expiresAt,
    ]);
    const claimed = (result.rowCount ?? 0) > 0;
    logger.debug({ idempotency_key: record.idempotency_key, payment_id: record.payment_id, claimed, expires_at: expiresAt }, 'Idempotency tryInsert');
    return claimed;
  }

  async updateResponse(key: string, status: number, body: unknown): Promise<void> {
    await this.db.query(SQL.UPDATE_IDEMPOTENCY_RESPONSE, [status, JSON.stringify(body), key]);
    logger.debug({ idempotency_key: key, status }, 'Idempotency response cached');
  }
}
