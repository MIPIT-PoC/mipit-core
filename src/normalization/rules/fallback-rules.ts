import type { CanonicalPacs008 } from '../../domain/models/canonical.js';

export function applyFallbacks(canonical: CanonicalPacs008): CanonicalPacs008 {
  return {
    ...canonical,
    purpose: canonical.purpose || 'P2P',
    reference: canonical.reference || 'MIPIT-POC',
  };
}
