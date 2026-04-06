/**
 * Token Bucket Rate Limiter
 *
 * Controls the rate of payments sent to each rail to prevent
 * overwhelming downstream systems and respecting rail-specific limits.
 *
 * Algorithm: Token Bucket
 *   - Bucket starts full with `maxTokens` tokens
 *   - Each request consumes 1 token
 *   - Tokens refill at `refillRate` tokens per second
 *   - If no tokens available, request is rejected or queued
 *
 * Configuration per rail from constants.ts RAIL_RATE_LIMITS.
 */

import { RAIL_RATE_LIMITS } from '../config/constants.js';
import { logger } from '../observability/logger.js';

export class RateLimitExceededError extends Error {
  constructor(
    public readonly rail: string,
    public readonly retryAfterMs: number,
  ) {
    super(`Rate limit exceeded for rail ${rail}. Retry after ${retryAfterMs}ms`);
    this.name = 'RateLimitExceededError';
  }
}

interface TokenBucket {
  tokens: number;
  maxTokens: number;
  refillRatePerMs: number;
  lastRefillAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly log = logger.child({ component: 'rate-limiter' });

  constructor() {
    // Initialize buckets for each configured rail
    for (const [rail, config] of Object.entries(RAIL_RATE_LIMITS)) {
      this.buckets.set(rail, {
        tokens: config.maxPerSecond,
        maxTokens: config.maxPerSecond,
        refillRatePerMs: config.maxPerSecond / 1000,
        lastRefillAt: Date.now(),
      });
    }
  }

  /**
   * Attempt to consume a token for the given rail.
   * Throws RateLimitExceededError if no tokens available.
   */
  acquire(rail: string): void {
    const bucket = this.buckets.get(rail);
    if (!bucket) {
      // No rate limit configured for this rail
      return;
    }

    this.refill(bucket);

    if (bucket.tokens < 1) {
      const retryAfterMs = Math.ceil((1 - bucket.tokens) / bucket.refillRatePerMs);
      this.log.warn({ rail, retryAfterMs }, 'Rate limit exceeded');
      throw new RateLimitExceededError(rail, retryAfterMs);
    }

    bucket.tokens -= 1;
  }

  /**
   * Check if a request would be allowed without consuming a token.
   */
  canAcquire(rail: string): boolean {
    const bucket = this.buckets.get(rail);
    if (!bucket) return true;

    this.refill(bucket);
    return bucket.tokens >= 1;
  }

  /**
   * Get current rate limiter status for all rails (for dashboard).
   */
  getStatus(): Array<{ rail: string; availableTokens: number; maxTokens: number; utilizationPct: number }> {
    const result: Array<{ rail: string; availableTokens: number; maxTokens: number; utilizationPct: number }> = [];

    for (const [rail, bucket] of this.buckets) {
      this.refill(bucket);
      result.push({
        rail,
        availableTokens: Math.floor(bucket.tokens),
        maxTokens: bucket.maxTokens,
        utilizationPct: Math.round((1 - bucket.tokens / bucket.maxTokens) * 100),
      });
    }

    return result;
  }

  private refill(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefillAt;

    if (elapsed > 0) {
      bucket.tokens = Math.min(
        bucket.maxTokens,
        bucket.tokens + elapsed * bucket.refillRatePerMs,
      );
      bucket.lastRefillAt = now;
    }
  }
}
