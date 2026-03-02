import type { Pool } from 'pg';
import { SQL } from '../queries/index.js';

export interface IdempotencyRecord {
  idempotency_key: string;
  request_hash: string;
  response_status?: number;
  response_body?: unknown;
  created_at: string;
}

export class IdempotencyRepository {
  constructor(private readonly db: Pool) {}

  async findByKey(key: string): Promise<IdempotencyRecord | null> {
    const result = await this.db.query(SQL.FIND_IDEMPOTENCY_BY_KEY, [key]);
    return (result.rows[0] as IdempotencyRecord) ?? null;
  }

  async insert(record: IdempotencyRecord): Promise<void> {
    await this.db.query(SQL.INSERT_IDEMPOTENCY, [
      record.idempotency_key,
      record.request_hash,
      record.response_status,
      record.response_body ? JSON.stringify(record.response_body) : null,
      record.created_at,
    ]);
  }

  async updateResponse(key: string, status: number, body: unknown): Promise<void> {
    await this.db.query(SQL.UPDATE_IDEMPOTENCY_RESPONSE, [status, JSON.stringify(body), key]);
  }
}
