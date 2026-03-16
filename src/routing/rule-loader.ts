import type { RouteRule } from '../domain/models/route-rule.js';
import type { RouteRuleRepository } from '../persistence/repositories/route-rule.repository.js';
import { logger } from '../observability/logger.js';

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  rules: RouteRule[];
  loadedAt: number;
}

export class RuleLoader {
  private cache: CacheEntry | null = null;

  constructor(private readonly repo: RouteRuleRepository) {}

  async loadActiveRules(): Promise<RouteRule[]> {
    if (this.cache && Date.now() - this.cache.loadedAt < TTL_MS) {
      logger.debug({ source: 'cache', count: this.cache.rules.length }, 'Route rules cache hit');
      return this.cache.rules;
    }

    const rules = await this.repo.findActive();
    this.cache = { rules, loadedAt: Date.now() };
    logger.debug({ source: 'db', count: rules.length }, 'Route rules loaded from DB');
    return rules;
  }

  clearCache(): void {
    this.cache = null;
    logger.debug('Route rules cache cleared');
  }
}
