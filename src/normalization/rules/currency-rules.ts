import type { CanonicalPacs008 } from '../../domain/models/canonical.js';

export function normalizeCurrency(canonical: CanonicalPacs008): CanonicalPacs008 {
  // TODO: Normalize currency codes to uppercase, apply FX if cross-currency
  return {
    ...canonical,
    amount: {
      ...canonical.amount,
      currency: canonical.amount.currency.toUpperCase(),
    },
  };
}
