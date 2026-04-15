/**
 * Deadline-aware retry with exponential backoff + jitter.
 *
 * Key property: retries check the caller-supplied deadline BEFORE each
 * attempt. If the remaining budget is less than the next backoff, we
 * fail fast with DeadlineExceededError rather than burning through
 * the Commerce Hub 5-minute timestamp window mid-retry.
 */

import { CommerceHubError, DeadlineExceededError } from './errors.js';

export interface RetryPolicy {
  /** Maximum number of attempts including the first one. Default: 3. */
  maxAttempts: number;
  /** Base delay in ms for the first retry. Default: 100. */
  baseDelayMs: number;
  /** Cap on individual backoff delay. Default: 2000. */
  maxDelayMs: number;
  /** Absolute deadline (epoch ms). Undefined = no deadline. */
  deadline?: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 2000,
};

/**
 * Run an async operation with retry-on-retryable-failure and deadline awareness.
 *
 * @param op The operation to run. Receives the attempt number (0-indexed).
 * @param policy Retry policy. Falls back to DEFAULT_RETRY_POLICY.
 * @throws {DeadlineExceededError} If the caller's deadline is exceeded.
 * @throws {CommerceHubError} The last error encountered if all retries fail.
 */
export async function withRetry<T>(
  op: (attempt: number) => Promise<T>,
  policy: Partial<RetryPolicy> = {}
): Promise<T> {
  const p: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...policy };
  let lastError: unknown;

  for (let attempt = 0; attempt < p.maxAttempts; attempt++) {
    // Deadline check before attempting
    if (p.deadline !== undefined && Date.now() >= p.deadline) {
      throw new DeadlineExceededError({
        message: `Deadline exceeded before attempt ${attempt + 1} of ${p.maxAttempts}`,
      });
    }

    try {
      return await op(attempt);
    } catch (err) {
      lastError = err;

      // Not a CH error — don't retry, let it surface
      if (!(err instanceof CommerceHubError)) {
        throw err;
      }

      // Non-retryable CH errors surface immediately
      if (!err.retryable) {
        throw err;
      }

      // Last attempt — don't sleep, just throw
      if (attempt === p.maxAttempts - 1) {
        throw err;
      }

      const delay = computeBackoff(attempt, p.baseDelayMs, p.maxDelayMs);

      // If the delay would exceed the deadline, fail fast instead
      if (p.deadline !== undefined && Date.now() + delay >= p.deadline) {
        throw new DeadlineExceededError({
          message:
            `Deadline would be exceeded by retry backoff ` +
            `(remaining: ${p.deadline - Date.now()}ms, needed: ${delay}ms)`,
        });
      }

      await sleep(delay);
    }
  }

  // Should be unreachable — the loop always throws on the last attempt.
  throw lastError ?? new Error('withRetry: exhausted attempts with no error');
}

/**
 * Compute exponential backoff with full jitter.
 * @internal exported for testing
 */
export function computeBackoff(attempt: number, baseMs: number, maxMs: number): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  // Full jitter: random value in [0, exp]
  return Math.floor(Math.random() * exp);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
