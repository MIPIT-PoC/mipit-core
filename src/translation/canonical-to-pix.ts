import type { CanonicalPacs008 } from '../domain/models/canonical.js';

export async function canonicalToPix(_canonical: CanonicalPacs008): Promise<unknown> {
  // TODO: Implement Canonical pacs.008 → PIX translation
  // 1. Extract fields needed by PIX adapter
  // 2. Format amounts, dates, and IDs per PIX spec
  // 3. Return PIX-native payload
  throw new Error('canonicalToPix not yet implemented');
}
