/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures when a downstream rail/service is unavailable.
 *
 * States:
 *   CLOSED   → Normal operation. Failures are counted.
 *   OPEN     → Service is considered down. All calls fail fast with CircuitOpenError.
 *   HALF_OPEN → After cooldown, allow a single probe request to test recovery.
 *
 * Transitions:
 *   CLOSED → OPEN:      when failureCount >= failureThreshold within the window
 *   OPEN → HALF_OPEN:   after cooldownMs elapses
 *   HALF_OPEN → CLOSED: if the probe succeeds
 *   HALF_OPEN → OPEN:   if the probe fails
 *
 * Usage:
 *   const breaker = new CircuitBreaker('PIX', { failureThreshold: 5, cooldownMs: 30000 });
 *   const result = await breaker.execute(() => sendPixPayment(payload));
 */

import { logger } from '../observability/logger.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms to wait before transitioning from OPEN to HALF_OPEN */
  cooldownMs: number;
  /** Time window in ms for counting failures (rolling window) */
  windowMs: number;
  /** Percentage of failures in window to trigger OPEN (0-100) */
  failureRateThreshold?: number;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  cooldownMs: 30_000,
  windowMs: 60_000,
  failureRateThreshold: 50,
};

export class CircuitOpenError extends Error {
  constructor(public readonly serviceName: string, public readonly nextRetryAt: Date) {
    super(`Circuit breaker OPEN for ${serviceName}. Next retry at ${nextRetryAt.toISOString()}`);
    this.name = 'CircuitOpenError';
  }
}

interface FailureRecord {
  timestamp: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures: FailureRecord[] = [];
  private successes: number = 0;
  private lastFailureAt: number = 0;
  private openedAt: number = 0;
  private readonly options: CircuitBreakerOptions;
  private readonly log;

  constructor(
    private readonly serviceName: string,
    options?: Partial<CircuitBreakerOptions>,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.log = logger.child({ circuit_breaker: serviceName });
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws CircuitOpenError if the circuit is OPEN.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.shouldTransitionToHalfOpen()) {
        this.transitionTo('HALF_OPEN');
      } else {
        const nextRetry = new Date(this.openedAt + this.options.cooldownMs);
        throw new CircuitOpenError(this.serviceName, nextRetry);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.successes++;

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('CLOSED');
      this.log.info('Circuit breaker recovered — probe succeeded');
    }
  }

  private onFailure(): void {
    const now = Date.now();
    this.failures.push({ timestamp: now });
    this.lastFailureAt = now;

    // Clean old failures outside the window
    this.pruneOldFailures();

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
      this.log.warn('Circuit breaker re-opened — probe failed');
      return;
    }

    if (this.state === 'CLOSED' && this.shouldOpen()) {
      this.transitionTo('OPEN');
      this.log.warn(
        { failureCount: this.failures.length, threshold: this.options.failureThreshold },
        'Circuit breaker opened — failure threshold exceeded',
      );
    }
  }

  private shouldOpen(): boolean {
    // Check absolute threshold
    if (this.failures.length >= this.options.failureThreshold) {
      return true;
    }

    // Check failure rate if enough samples
    const totalInWindow = this.successes + this.failures.length;
    if (totalInWindow >= 10 && this.options.failureRateThreshold) {
      const failureRate = (this.failures.length / totalInWindow) * 100;
      return failureRate >= this.options.failureRateThreshold;
    }

    return false;
  }

  private shouldTransitionToHalfOpen(): boolean {
    return Date.now() - this.openedAt >= this.options.cooldownMs;
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    if (newState === 'OPEN') {
      this.openedAt = Date.now();
    }

    if (newState === 'CLOSED') {
      this.failures = [];
      this.successes = 0;
    }

    this.log.info({ from: oldState, to: newState }, 'Circuit breaker state transition');
  }

  private pruneOldFailures(): void {
    const cutoff = Date.now() - this.options.windowMs;
    this.failures = this.failures.filter((f) => f.timestamp > cutoff);
  }

  /** Get current state (for health checks and dashboards) */
  getState(): { state: CircuitState; failures: number; lastFailureAt: number | null; service: string } {
    return {
      state: this.state,
      failures: this.failures.length,
      lastFailureAt: this.lastFailureAt || null,
      service: this.serviceName,
    };
  }
}

/**
 * Registry of circuit breakers per rail.
 * Allows centralized monitoring and management.
 */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  get(serviceName: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
    let breaker = this.breakers.get(serviceName);
    if (!breaker) {
      breaker = new CircuitBreaker(serviceName, options);
      this.breakers.set(serviceName, breaker);
    }
    return breaker;
  }

  /** Get all circuit breaker states (for dashboard) */
  getAllStates(): Array<{ state: CircuitState; failures: number; lastFailureAt: number | null; service: string }> {
    return Array.from(this.breakers.values()).map((b) => b.getState());
  }
}

/** Global singleton registry */
export const circuitBreakerRegistry = new CircuitBreakerRegistry();
