import type { CanonicalPacs008 } from '../domain/models/canonical.js';

export async function pixToCanonical(
  _payload: unknown,
  _paymentId: string,
  _traceId?: string,
): Promise<CanonicalPacs008> {
  // TODO: Implement PIX → Canonical pacs.008 translation
  // 1. Parse PIX-specific payload fields
  // 2. Map to canonical schema fields
  // 3. Validate against canonicalPacs008Schema
  throw new Error('pixToCanonical not yet implemented');
}
