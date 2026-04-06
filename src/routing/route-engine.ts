import type { CanonicalPacs008 } from '../domain/models/canonical.js';
import type { RouteRule } from '../domain/models/route-rule.js';
import type { RuleLoader } from './rule-loader.js';
import { RoutingError } from '../domain/errors/index.js';
import { RAIL_OPERATING_HOURS } from '../config/constants.js';
import { logger } from '../observability/logger.js';
import { startLatencyTimer, recordRoutingDecision } from '../observability/metrics.js';

export interface RouteResult {
  destination: string;
  ruleName: string;
}

export class RouteEngine {
  constructor(private readonly ruleLoader: RuleLoader) {}

  async resolve(canonical: CanonicalPacs008): Promise<RouteResult> {
    const stopTimer = startLatencyTimer('routing');
    const log = logger.child({ payment_id: canonical.payment_id, origin_rail: canonical.origin.rail });

    log.info('Starting routing resolution');
    const rules = await this.ruleLoader.loadActiveRules();
    const sorted = rules.sort((a, b) => a.priority - b.priority);

    for (const rule of sorted) {
      if (this.matches(rule, canonical)) {
        stopTimer();
        recordRoutingDecision(rule.rule_name, rule.destination_rail);
        log.info(
          { rule: rule.rule_name, destination: rule.destination_rail },
          'Routing rule matched',
        );
        return {
          destination: rule.destination_rail,
          ruleName: rule.rule_name,
        };
      }
    }

    stopTimer();
    log.error({ rulesEvaluated: sorted.length }, 'No routing rule matched');
    throw new RoutingError('No routing rule matched for payment', {
      payment_id: canonical.payment_id,
      origin_rail: canonical.origin.rail,
    });
  }

  private matches(rule: RouteRule, canonical: CanonicalPacs008): boolean {
    const { condition_field, condition_value } = rule;

    switch (condition_field) {
      case 'alias.type': {
        const aliasType = this.inferAliasType(canonical.creditor?.account_id ?? '');
        return condition_value === aliasType;
      }
      case 'destination_country':
        return canonical.creditor?.country === condition_value;
      case 'availability':
        return condition_value === 'always' || condition_value === 'true';
      case 'amount.range': {
        // condition_value format: "min-max" e.g. "0-1000" or "1000-999999999"
        const [minStr, maxStr] = condition_value.split('-');
        const min = parseFloat(minStr);
        const max = parseFloat(maxStr);
        return canonical.amount.value >= min && canonical.amount.value <= max;
      }
      case 'rail.operating_hours': {
        // condition_value: the destination rail name — check if it's within operating hours
        return this.isRailOpen(condition_value);
      }
      case 'currency':
        return canonical.amount.currency.toUpperCase() === condition_value.toUpperCase();
      default:
        return false;
    }
  }

  /**
   * Infers the alias type from the creditor account format.
   * Supports both PoC prefixes and real-world patterns.
   */
  private inferAliasType(alias: string): string {
    if (alias.startsWith('PIX-')) return 'PIX_KEY';
    if (alias.startsWith('SPEI-')) return 'CLABE';
    if (alias.startsWith('BREB-')) return 'LLAVE_BREB';

    // Real patterns
    if (/^\d{11}$/.test(alias)) return 'PIX_KEY';       // CPF
    if (/^\d{14}$/.test(alias)) return 'PIX_KEY';       // CNPJ
    if (/^\+55\d{10,11}$/.test(alias)) return 'PIX_KEY'; // BR phone
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(alias)) return 'PIX_KEY'; // EVP
    if (/^\d{18}$/.test(alias)) return 'CLABE';          // CLABE
    if (/^\+57\d{10}$/.test(alias)) return 'LLAVE_BREB'; // CO phone
    if (/^\d{9,10}(-\d)?$/.test(alias)) return 'LLAVE_BREB'; // NIT
    if (/^[A-Z]{2}\d{2}[A-Z0-9]{4,}$/.test(alias)) return 'IBAN';
    if (/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(alias)) return 'BIC';

    return 'ACCOUNT';
  }

  /**
   * Checks if a rail is currently within its operating hours.
   */
  private isRailOpen(rail: string): boolean {
    const schedule = RAIL_OPERATING_HOURS[rail];
    if (!schedule) return true; // Unknown rail → assume always open

    const now = new Date(Date.now() + schedule.tz * 60 * 60 * 1000);
    const day = now.getUTCDay();
    const hhmm = now.getUTCHours() * 100 + now.getUTCMinutes();

    return schedule.days.includes(day) && hhmm >= schedule.startHhmm && hhmm <= schedule.endHhmm;
  }
}
