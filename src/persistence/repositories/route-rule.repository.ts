import type { Pool } from 'pg';
import type { RouteRule } from '../../domain/models/route-rule.js';
import { SQL } from '../queries/index.js';

export class RouteRuleRepository {
  constructor(private readonly db: Pool) {}

  async findActive(): Promise<RouteRule[]> {
    const result = await this.db.query(SQL.FIND_ACTIVE_ROUTE_RULES);
    return result.rows as RouteRule[];
  }

  async findById(id: string): Promise<RouteRule | null> {
    const result = await this.db.query(SQL.FIND_ROUTE_RULE_BY_ID, [id]);
    return (result.rows[0] as RouteRule) ?? null;
  }
}
