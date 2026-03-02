import type { CanonicalPacs008 } from '../../domain/models/canonical.js';
import { ulid } from 'ulid';

export function normalizeIds(canonical: CanonicalPacs008): CanonicalPacs008 {
  // Ensure endToEndId and msgId are populated
  return {
    ...canonical,
    grpHdr: {
      ...canonical.grpHdr,
      msgId: canonical.grpHdr.msgId || `MSG-${ulid()}`,
    },
    pmtId: {
      ...canonical.pmtId,
      endToEndId: canonical.pmtId.endToEndId || `E2E-${ulid()}`,
    },
  };
}
