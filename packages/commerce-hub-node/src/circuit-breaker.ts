/**
 * Circuit breaker for Commerce Hub upstream calls.
 *
 * States:
 *   closed → normal operation, requests pass through
 *   open   → fail fast with CircuitOpenError
 *   half   → one trial request allowed; success → closed, failure → open
 *
 * Defaults:
 *   - open after 5 consecutive failures within a 10-second window
 *   - stay open for 30 seconds before transitioning to half-open
 *
 * This is intentionally small (~120 LOC) and has no external dependency.
 * For production multi-instance deployments the breaker state should
 * live in Redis — documented in OBSERVABILITY.md but out of scope
 * for the POC.
 */

import { CircuitOpenError, CommerceHubError } from './errors.js';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Consecutive failures before opening. Default: 5. */
  failureThreshold: number;
  /** Time window in ms for counting failures. Default: 10_000. */
  rollingWindowMs: number;
  /** How long to stay open before transitioning to half-open. Default: 30_000. */
  openDurationMs: number;
  /** Clock source — injectable for tests. Default: Date.now. */
  now?: () => number;
}

const DEFAULTS: Required<Omit<CircuitBreakerConfig, 'now'>> = {
  failureThreshold: 5,
  rollingWindowMs: 10_000,
  openDurationMs: 30_000,
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private readonly failureTimestamps: number[] = [];
  private openedAt = 0;

  private readonly config: Required<CircuitBreakerConfig>;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      ...DEFAULTS,
      now: Date.now,
      ...config,
    };
  }

  /** Current state — used for metrics and /readyz. */
  getState(): CircuitState {
    this.maybeTransitionFromOpen();
    return this.state;
  }

  /**
   * Execute an operation through the breaker.
   *
   * @throws {CircuitOpenError} If the breaker is open.
   * @throws The original error if the operation fails.
   */
  async execute<T>(op: () => Promise<T>): Promise<T> {
    this.maybeTransitionFromOpen();

    if (this.state === 'open') {
      throw new CircuitOpenError({
        message:
          'Commerce Hub circuit breaker is open — failing fast. ' +
          'Upstream is considered unhealthy until the cooldown elapses.',
      });
    }

    try {
      const result = await op();
      this.onSuccess();
      return result;
    } catch (err) {
      // Only count retryable errors as breaker failures.
      // Validation/Auth errors are caller mistakes, not upstream problems.
      if (err instanceof CommerceHubError && !err.retryable) {
        throw err;
      }
      this.onFailure();
      throw err;
    }
  }

  /** Reset the breaker to closed state. Used by tests and /readyz manual recovery. */
  reset(): void {
    this.state = 'closed';
    this.failureTimestamps.length = 0;
    this.openedAt = 0;
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.state = 'closed';
    }
    // Clear the failure window on any success
    this.failureTimestamps.length = 0;
  }

  private onFailure(): void {
    const now = this.config.now();
    if (this.state === 'half-open') {
      // Trial failed → reopen
      this.state = 'open';
      this.openedAt = now;
      return;
    }

    // Prune stale failures outside the rolling window
    const cutoff = now - this.config.rollingWindowMs;
    while (this.failureTimestamps.length > 0 && this.failureTimestamps[0]! < cutoff) {
      this.failureTimestamps.shift();
    }
    this.failureTimestamps.push(now);

    if (this.failureTimestamps.length >= this.config.failureThreshold) {
      this.state = 'open';
      this.openedAt = now;
      this.failureTimestamps.length = 0;
    }
  }

  private maybeTransitionFromOpen(): void {
    if (this.state !== 'open') return;
    const now = this.config.now();
    if (now - this.openedAt >= this.config.openDurationMs) {
      this.state = 'half-open';
    }
  }
}
