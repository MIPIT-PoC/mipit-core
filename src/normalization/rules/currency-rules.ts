import type { CanonicalPacs008 } from '../../domain/models/canonical.js';
import { getFxService } from '../../fx/fx-service.js';
import { logger } from '../../observability/logger.js';

/** Native (local) currency for each supported rail */
const RAIL_LOCAL_CURRENCY: Record<string, string> = {
  PIX:         'BRL',
  SPEI:        'MXN',
  BRE_B:       'COP',
  ACH_NACHA:   'USD',
  FEDNOW:      'USD',
  SWIFT_MT103: 'USD',
  ISO20022_MX: 'EUR',
};

/**
 * Normalizes currency and applies real-time FX conversion when the payment
 * crosses currency zones (e.g. PIX BRL → SPEI MXN, PIX BRL → BRE_B COP).
 *
 * Flow:
 *  1. Detect the local (native) currency of the origin rail
 *  2. If canonical.amount.currency != local currency → cross-currency
 *  3. Fetch real-time rate from Open Exchange Rates API (cached 5 min)
 *  4. Populate canonical.fx: { rate, source_currency, target_currency, local_amount }
 *  5. Target adapter uses fx.rate to convert the amount to local currency
 *
 * If OPEN_EXCHANGE_RATES_APP_ID is not set, falls back to hardcoded approximate rates.
 * If the API call fails, leaves canonical.fx empty (adapter receives amount as-is).
 */
export async function normalizeCurrency(canonical: CanonicalPacs008): Promise<CanonicalPacs008> {
  const uppercaseCurrency = canonical.amount.currency.toUpperCase();
  const localCurrency = RAIL_LOCAL_CURRENCY[canonical.origin.rail];

  // Always uppercase the currency code
  let result: CanonicalPacs008 = {
    ...canonical,
    amount: { ...canonical.amount, currency: uppercaseCurrency },
  };

  // Same currency — no conversion needed
  if (!localCurrency || uppercaseCurrency === localCurrency) {
    return result;
  }

  logger.debug(
    { rail: canonical.origin.rail, from: uppercaseCurrency, to: localCurrency },
    'Cross-currency payment — fetching real-time FX rate',
  );

  try {
    const fxSvc = getFxService();
    // rate: how many units of localCurrency per 1 unit of payment currency
    const rate = await fxSvc.getRate(uppercaseCurrency, localCurrency);
    const localAmount = await fxSvc.convert(canonical.amount.value, uppercaseCurrency, localCurrency);

    result = {
      ...result,
      fx: {
        source_currency: uppercaseCurrency,
        target_currency: localCurrency,
        rate,
        local_amount: localAmount,
      },
    };

    logger.info(
      {
        from: uppercaseCurrency,
        to: localCurrency,
        rate,
        original_amount: canonical.amount.value,
        converted_amount: localAmount,
      },
      'Real-time FX conversion applied',
    );
  } catch (err) {
    logger.warn({ err }, 'FX rate fetch failed — adapter will use original amount without conversion');
  }

  return result;
}
