import type { CanonicalPacs008 } from '../../domain/models/canonical.js';
import { logger } from '../../observability/logger.js';

export function normalizeDates(canonical: CanonicalPacs008): CanonicalPacs008 {
  const safeToISO = (val: string, field: string): string => {
    const date = new Date(val);
    if (isNaN(date.getTime())) {
      logger.warn({ field, value: val }, 'Invalid date detected, keeping original value');
      return val;
    }
    return date.toISOString();
  };

  return {
    ...canonical,
    created_at: safeToISO(canonical.created_at, 'created_at'),
    grpHdr: {
      ...canonical.grpHdr,
      creDtTm: safeToISO(canonical.grpHdr.creDtTm, 'grpHdr.creDtTm'),
    },
  };
}
