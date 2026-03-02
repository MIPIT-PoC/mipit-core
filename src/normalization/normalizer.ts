import type { CanonicalPacs008 } from '../domain/models/canonical.js';
import { normalizeDates } from './rules/date-rules.js';
import { normalizeCurrency } from './rules/currency-rules.js';
import { normalizeIds } from './rules/id-rules.js';
import { applyFallbacks } from './rules/fallback-rules.js';

export class Normalizer {
  async normalize(canonical: CanonicalPacs008): Promise<CanonicalPacs008> {
    let result = { ...canonical };

    result = normalizeDates(result);
    result = normalizeCurrency(result);
    result = normalizeIds(result);
    result = applyFallbacks(result);

    return result;
  }
}
