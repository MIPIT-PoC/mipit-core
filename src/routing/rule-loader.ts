import type { RouteRule } from '../domain/models/route-rule.js';
import type { RouteRuleRepository } from '../persistence/repositories/route-rule.repository.js';

export class RuleLoader {
  constructor(private readonly repo: RouteRuleRepository) {}

  async loadActiveRules(): Promise<RouteRule[]> {
    return this.repo.findActive();
  }
}
