import type { CanonicalPacs008 } from '../domain/models/canonical.js';
import type { RouteRule } from '../domain/models/route-rule.js';
import type { RuleLoader } from './rule-loader.js';
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
          ruleName: rule.rule_name,
        };
      }
    }

    throw new RoutingError('No routing rule matched for payment', {
      payment_id: canonical.payment_id,
      origin_rail: canonical.origin.rail,
    });
  }

  private matches(rule: RouteRule, canonical: CanonicalPacs008): boolean {
    const { condition_field, condition_value } = rule;

    switch (condition_field) {
      case 'alias.type': {
        const credAlias = canonical.creditor?.account_id ?? '';
        if (credAlias.startsWith('PIX-')) return condition_value === 'PIX_KEY';
        if (credAlias.startsWith('SPEI-')) return condition_value === 'CLABE';
        return false;
      }
      case 'destination_country':
        return canonical.creditor?.country === condition_value;
      case 'availability':
        return false;
      default:
        return false;
    }
  }
}
