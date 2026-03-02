import type { CanonicalPacs008 } from '../domain/models/canonical.js';

export async function canonicalToSpei(_canonical: CanonicalPacs008): Promise<unknown> {
  // TODO: Implement Canonical pacs.008 → SPEI translation
  // 1. Extract fields needed by SPEI adapter
  // 2. Format CLABE, amounts, dates per SPEI spec
  // 3. Return SPEI-native payload
  throw new Error('canonicalToSpei not yet implemented');
}
