/**
 * FX Service — Real-time exchange rates via Open Exchange Rates API
 *
 * Free tier uses USD as base currency. All rates are stored as:
 *   rate = units of targetCurrency per 1 USD
 *   e.g. { BRL: 5.02, MXN: 17.43, COP: 4180.00, EUR: 0.92 }
 *
 * To convert amount in currencyA to currencyB:
 *   amountB = amountA * (rates[currencyB] / rates[currencyA])
 *
 * Cache: 5 minutes (rates update hourly on free tier).
 *
 * Supported currencies for MIPIT PoC:
 *   USD — US Dollar (ACH NACHA, FedNow, SWIFT)
 *   BRL — Brazilian Real (PIX)
 *   MXN — Mexican Peso (SPEI)
 *   COP — Colombian Peso (Bre-B)
 *   EUR — Euro (ISO 20022 MX, SWIFT)
 */

import { logger } from '../observability/logger.js';

const SUPPORTED_CURRENCIES = ['USD', 'BRL', 'MXN', 'COP', 'EUR'] as const;
type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number];

interface ExchangeRates {
  /** timestamp of when rates were fetched */
  fetchedAt: number;
  /** rates keyed by currency code, all relative to USD base */
  rates: Record<SupportedCurrency, number>;
}

/** Hardcoded fallback rates used when API is unavailable (approximate values) */
const FALLBACK_RATES: Record<SupportedCurrency, number> = {
  USD: 1.0,
  BRL: 5.02,
  MXN: 17.43,
  COP: 4180.0,
  EUR: 0.92,
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class FxService {
  private cache: ExchangeRates | null = null;

  constructor(
    private readonly appId: string | undefined,
    private readonly baseUrl: string = 'https://openexchangerates.org/api',
  ) {}

  /**
   * Returns the conversion rate from sourceCurrency to targetCurrency.
   * Uses cached rates when available and fresh.
   *
   * Example: getRate('BRL', 'USD') → 0.199  (1 BRL = 0.199 USD)
   */
  async getRate(source: string, target: string): Promise<number> {
    if (source === target) return 1;

    const rates = await this.getRates();
    const srcRate = rates[source as SupportedCurrency] ?? 1;
    const tgtRate = rates[target as SupportedCurrency] ?? 1;

    // Convert via USD: amount_src / rate_src * rate_tgt
    return tgtRate / srcRate;
  }

  /**
   * Converts an amount from one currency to another.
   */
  async convert(amount: number, from: string, to: string): Promise<number> {
    const rate = await this.getRate(from, to);
    const converted = amount * rate;
    // Round to 2 decimal places
    return Math.round(converted * 100) / 100;
  }

  /** Returns all rates, fetching from API if cache is stale */
  async getRates(): Promise<Record<SupportedCurrency, number>> {
    const now = Date.now();

    if (this.cache && (now - this.cache.fetchedAt) < CACHE_TTL_MS) {
      return this.cache.rates;
    }

    if (!this.appId) {
      logger.warn('OPEN_EXCHANGE_RATES_APP_ID not set — using fallback rates');
      return FALLBACK_RATES;
    }

    try {
      const symbols = SUPPORTED_CURRENCIES.join(',');
      const url = `${this.baseUrl}/latest.json?app_id=${this.appId}&symbols=${symbols}&base=USD`;

      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) {
        throw new Error(`Open Exchange Rates API returned HTTP ${res.status}`);
      }

      const body = await res.json() as {
        rates: Partial<Record<SupportedCurrency, number>>;
        timestamp: number;
      };

      const rates = { ...FALLBACK_RATES };
      for (const currency of SUPPORTED_CURRENCIES) {
        if (body.rates[currency] !== undefined) {
          rates[currency] = body.rates[currency]!;
        }
      }

      this.cache = { fetchedAt: now, rates };
      logger.info({ rates }, 'FX rates refreshed from Open Exchange Rates');
      return rates;
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch FX rates — using fallback rates');
      // Don't update cache on error so we retry sooner
      return this.cache?.rates ?? FALLBACK_RATES;
    }
  }

  /** Invalidate the cache (useful for tests) */
  invalidateCache(): void {
    this.cache = null;
  }
}

/** Singleton instance — initialized with env var */
let _instance: FxService | null = null;

export function getFxService(): FxService {
  if (!_instance) {
    _instance = new FxService(process.env['OPEN_EXCHANGE_RATES_APP_ID']);
  }
  return _instance;
}
