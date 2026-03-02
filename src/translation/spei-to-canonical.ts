import type { CanonicalPacs008 } from '../domain/models/canonical.js';

export async function speiToCanonical(
  _payload: unknown,
  _paymentId: string,
  _traceId?: string,
): Promise<CanonicalPacs008> {
  // TODO: Implement SPEI → Canonical pacs.008 translation
  // 1. Parse SPEI-specific payload fields (CLABE, etc.)
  // 2. Map to canonical schema fields
  // 3. Validate against canonicalPacs008Schema
  throw new Error('speiToCanonical not yet implemented');
}
