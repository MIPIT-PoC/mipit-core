/**
 * P05 — ISO 4217 currency precision metadata + amount formatting.
 *
 * Different currencies have different valid decimal precision:
 *   - 0 decimals: BIF, CLP, COP, ISK, JPY, KRW, PYG, VND, etc.
 *   - 2 decimals: USD, EUR, GBP, BRL, MXN (the common case)
 *   - 3 decimals: BHD, JOD, KWD, OMR, TND (oil-region dinars)
 *   - 4 decimals: CLF, UYW (special)
 *
 * The previous codebase had `Math.round(x*100)/100` hard-coded everywhere,
 * which mis-renders COP (`420000.46` instead of `420000`) and would
 * over-round JPY (no centavos).
 */

const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW',
  'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
  'COP', // Colombian Peso — no centavos in BanRep practice
]);

const THREE_DECIMAL_CURRENCIES = new Set([
  'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND',
]);

const FOUR_DECIMAL_CURRENCIES = new Set([
  'CLF', 'UYW',
]);

/** Default decimal places when currency not in any known set. */
export const DEFAULT_DECIMALS = 2;

export function getCurrencyDecimals(ccy: string): number {
  const upper = ccy.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(upper)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(upper)) return 3;
  if (FOUR_DECIMAL_CURRENCIES.has(upper)) return 4;
  return DEFAULT_DECIMALS;
}

export function isValidCurrencyCode(ccy: string): boolean {
  return /^[A-Z]{3}$/.test(ccy);
}

/**
 * Banker's rounding (round-half-to-even) — fair for high-volume FX.
 *
 *   roundToCurrency(1.005, 'USD')   = 1.00   (0.5 rounds to even = down)
 *   roundToCurrency(1.015, 'USD')   = 1.02   (0.5 rounds to even = up)
 *   roundToCurrency(1000.7, 'COP')  = 1001
 *   roundToCurrency(1000.499, 'COP')= 1000
 */
export function roundToCurrency(amount: number, ccy: string): number {
  const decimals = getCurrencyDecimals(ccy);
  if (decimals === 0) {
    // For integer-only currencies, banker's rounding to nearest integer
    const floor = Math.floor(amount);
    const diff = amount - floor;
    if (Math.abs(diff - 0.5) < 1e-9) {
      return floor % 2 === 0 ? floor : floor + 1;
    }
    return Math.round(amount);
  }
  const factor = Math.pow(10, decimals);
  const scaled = amount * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  if (Math.abs(diff - 0.5) < 1e-9) {
    const r = floor % 2 === 0 ? floor : floor + 1;
    return r / factor;
  }
  return Math.round(scaled) / factor;
}

/**
 * Format amount per currency for wire-format emission.
 *   formatAmount(1000.5, 'COP')  = '1001'    (no centavos)
 *   formatAmount(1234.5, 'BRL')  = '1234.50' (2 decimals)
 *   formatAmount(100.123, 'KWD') = '100.123' (3 decimals)
 */
export function formatAmount(amount: number, ccy: string): string {
  const decimals = getCurrencyDecimals(ccy);
  return roundToCurrency(amount, ccy).toFixed(decimals);
}
