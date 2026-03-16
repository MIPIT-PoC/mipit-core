import type { CanonicalPacs008 } from '../domain/models/canonical.js';
import { normalizeDates } from './rules/date-rules.js';
import { normalizeCurrency } from './rules/currency-rules.js';
import { normalizeIds } from './rules/id-rules.js';
import { applyFallbacks } from './rules/fallback-rules.js';
import { logger } from '../observability/logger.js';
import { startLatencyTimer } from '../observability/metrics.js';

export class Normalizer {
  async normalize(canonical: CanonicalPacs008): Promise<CanonicalPacs008> {
    const stopTimer = startLatencyTimer('normalization');
    const log = logger.child({ payment_id: canonical.payment_id, rail: canonical.origin.rail });

    log.info('Starting normalization');
    let result = { ...canonical };

    result = normalizeDates(result);
    result = normalizeCurrency(result);
    result = normalizeIds(result);
    result = applyFallbacks(result);

    stopTimer();
    log.info(
      { currency: result.amount.currency, hasFx: !!result.fx?.target_currency },
      'Normalization complete',
    );
    return result;
  }
}
