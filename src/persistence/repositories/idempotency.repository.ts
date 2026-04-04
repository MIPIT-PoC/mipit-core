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

  async insert(record: IdempotencyRecord): Promise<void> {
    await this.db.query(SQL.INSERT_IDEMPOTENCY, [
      record.idempotency_key,
      record.payment_id,
      record.request_hash,
      record.response_status,
      record.response_body ? JSON.stringify(record.response_body) : null,
      record.created_at,
    ]);
    logger.debug({ idempotency_key: record.idempotency_key, payment_id: record.payment_id }, 'Idempotency key inserted');
  }

  /**
   * Atomically tries to insert an idempotency record.
   * Returns true if inserted (this request won the race), false if another request already claimed the key.
   */
  async tryInsert(record: Pick<IdempotencyRecord, 'idempotency_key' | 'payment_id' | 'request_hash' | 'created_at'>): Promise<boolean> {
    const result = await this.db.query(SQL.INSERT_IDEMPOTENCY, [
      record.idempotency_key,
      record.payment_id,
      record.request_hash,
      null,
      null,
      record.created_at,
    ]);
    const claimed = (result.rowCount ?? 0) > 0;
    logger.debug({ idempotency_key: record.idempotency_key, payment_id: record.payment_id, claimed }, 'Idempotency tryInsert');
    return claimed;
  }

  async updateResponse(key: string, status: number, body: unknown): Promise<void> {
    await this.db.query(SQL.UPDATE_IDEMPOTENCY_RESPONSE, [status, JSON.stringify(body), key]);
    logger.debug({ idempotency_key: key, status }, 'Idempotency response cached');
  }
}
