import type { Pool } from 'pg';
import type { MappingEntry } from '../../domain/models/mapping-entry.js';
import { SQL } from '../queries/index.js';
import { logger } from '../../observability/logger.js';

export class MappingRepository {
  constructor(private readonly db: Pool) {}

  async findByRail(rail: string, direction: string): Promise<MappingEntry[]> {
    const result = await this.db.query(SQL.FIND_MAPPINGS_BY_RAIL, [rail, direction]);
    const entries = result.rows as MappingEntry[];
    logger.debug({ rail, direction, count: entries.length }, 'Loaded mapping entries');
    return entries;
  }

  async findAll(): Promise<MappingEntry[]> {
    const result = await this.db.query(SQL.FIND_ALL_MAPPINGS);
    const entries = result.rows as MappingEntry[];
    logger.debug({ count: entries.length }, 'Loaded all mapping entries');
    return entries;
  }
}
