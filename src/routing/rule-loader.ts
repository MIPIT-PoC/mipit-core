import type { Pool } from 'pg';
import type { RouteRule } from '../domain/models/route-rule.js';

export class RuleLoader {
  constructor(private readonly db: Pool) {}

  async loadActiveRules(): Promise<RouteRule[]> {
    const result = await this.db.query(
      'SELECT * FROM route_rules WHERE active = true ORDER BY priority ASC',
    );
    return result.rows as RouteRule[];
  }
}
