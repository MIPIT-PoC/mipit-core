import type { Pool } from 'pg';

export interface FieldMapping {
  id: string;
  source_rail: string;
  source_field: string;
  canonical_field: string;
  transform?: string;
  active: boolean;
}

export class MappingLoader {
  constructor(private readonly db: Pool) {}

  async loadMappings(rail: string): Promise<FieldMapping[]> {
    // TODO: Load mapping_table entries from DB for the given rail
    const result = await this.db.query(
      'SELECT * FROM mapping_table WHERE source_rail = $1 AND active = true ORDER BY source_field',
      [rail],
    );
    return result.rows as FieldMapping[];
  }
}
