import type { Pool } from 'pg';
import type { FieldMapping } from '../../translation/mapping-loader.js';
import { SQL } from '../queries/index.js';

export class MappingRepository {
  constructor(private readonly db: Pool) {}

  async findByRail(rail: string): Promise<FieldMapping[]> {
    const result = await this.db.query(SQL.FIND_MAPPINGS_BY_RAIL, [rail]);
    return result.rows as FieldMapping[];
  }

  async findAll(): Promise<FieldMapping[]> {
    const result = await this.db.query(SQL.FIND_ALL_MAPPINGS);
    return result.rows as FieldMapping[];
  }
}
