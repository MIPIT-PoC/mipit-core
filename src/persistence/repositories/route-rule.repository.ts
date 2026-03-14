import type { Pool } from 'pg';
import type { RouteRule } from '../../domain/models/route-rule.js';
import { SQL } from '../queries/index.js';
import { logger } from '../../observability/logger.js';

export class RouteRuleRepository {
  constructor(private readonly db: Pool) {}

  async findActive(): Promise<RouteRule[]> {
    const result = await this.db.query(SQL.FIND_ACTIVE_RULES);
    const rules = result.rows as RouteRule[];
    logger.debug({ count: rules.length }, 'Loaded active route rules');
    return rules;
  }

  async findById(id: number): Promise<RouteRule | null> {
    const result = await this.db.query(SQL.FIND_ROUTE_RULE_BY_ID, [id]);
    const rule = (result.rows[0] as RouteRule) ?? null;
    logger.debug({ id, found: !!rule }, 'Route rule lookup');
    return rule;
  }
}
