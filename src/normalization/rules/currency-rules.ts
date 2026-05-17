import type { CanonicalPacs008 } from '../../domain/models/canonical.js';
import type { FxService } from '../../fx/fx-service.js';
import { getFxService } from '../../fx/fx-service.js';
import { logger } from '../../observability/logger.js';

/** Native (local) currency for each supported rail */
export const RAIL_LOCAL_CURRENCY: Record<string, string> = {
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
 * P05: When `canonical.destination.rail` is set (post-routing call), uses the
 * destination's native currency as the target. Otherwise falls back to the
 * origin's native (legacy pre-route call — usually a no-op since the input
 * arrives in origin's currency).
 *
 * Accepts an optional injected FxService for testability; falls back to singleton.
 */
export async function normalizeCurrency(canonical: CanonicalPacs008, injectedFxService?: FxService): Promise<CanonicalPacs008> {
  const uppercaseCurrency = canonical.amount.currency.toUpperCase();
  // P05 — prefer destination rail when known (post-route call); fall back to origin.
  const destRail = canonical.destination?.rail;
  const localCurrency = (destRail && RAIL_LOCAL_CURRENCY[destRail])
    ?? RAIL_LOCAL_CURRENCY[canonical.origin.rail];

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
    const fxSvc = injectedFxService ?? getFxService();
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
