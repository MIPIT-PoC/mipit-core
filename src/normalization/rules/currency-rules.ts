import type { CanonicalPacs008 } from '../../domain/models/canonical.js';
import { logger } from '../../observability/logger.js';

const RAIL_LOCAL_CURRENCY: Record<string, string> = {
  PIX: 'BRL',
  SPEI: 'MXN',
};

export function normalizeCurrency(canonical: CanonicalPacs008): CanonicalPacs008 {
  const uppercaseCurrency = canonical.amount.currency.toUpperCase();
  const localCurrency = RAIL_LOCAL_CURRENCY[canonical.origin.rail];

  let fx = canonical.fx;
  if (localCurrency && uppercaseCurrency !== localCurrency) {
    fx = {
      ...fx,
      source_currency: localCurrency,
      target_currency: uppercaseCurrency,
    };
    logger.debug(
      { rail: canonical.origin.rail, local: localCurrency, target: uppercaseCurrency },
      'FX cross-currency detected',
    );
  }

  return {
    ...canonical,
    amount: {
      ...canonical.amount,
      currency: uppercaseCurrency,
    },
    fx,
  };
}
