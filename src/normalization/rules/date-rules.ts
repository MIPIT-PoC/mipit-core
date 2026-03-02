import type { CanonicalPacs008 } from '../../domain/models/canonical.js';

export function normalizeDates(canonical: CanonicalPacs008): CanonicalPacs008 {
  // TODO: Ensure all dates are in UTC ISO-8601 format
  return {
    ...canonical,
    created_at: new Date(canonical.created_at).toISOString(),
    grpHdr: {
      ...canonical.grpHdr,
      creDtTm: new Date(canonical.grpHdr.creDtTm).toISOString(),
    },
  };
}
