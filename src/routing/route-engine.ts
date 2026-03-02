import type { CanonicalPacs008 } from '../domain/models/canonical.js';
import type { RouteRule } from '../domain/models/route-rule.js';
import { RuleLoader } from './rule-loader.js';
import { RoutingError } from '../domain/errors/index.js';

export interface RouteResult {
  destination: string;
  ruleName: string;
}

export class RouteEngine {
  constructor(private readonly ruleLoader: RuleLoader) {}

  async resolve(canonical: CanonicalPacs008): Promise<RouteResult> {
    const rules = await this.ruleLoader.loadActiveRules();

    const sorted = rules.sort((a, b) => a.priority - b.priority);

    for (const rule of sorted) {
      if (this.matches(rule, canonical)) {
        return {
          destination: rule.destination_rail,
          ruleName: rule.name,
        };
      }
    }

    throw new RoutingError('No routing rule matched for payment', {
      payment_id: canonical.payment_id,
      origin_rail: canonical.origin.rail,
    });
  }

  private matches(rule: RouteRule, canonical: CanonicalPacs008): boolean {
    if (rule.origin_rail && rule.origin_rail !== canonical.origin.rail) return false;
    if (rule.currency_match && rule.currency_match !== canonical.amount.currency) return false;
    if (rule.amount_min && canonical.amount.value < rule.amount_min) return false;
    if (rule.amount_max && canonical.amount.value > rule.amount_max) return false;
    if (rule.country_match && rule.country_match !== canonical.debtor.country) return false;
    return true;
  }
}
