import { describe, expect, it } from 'vitest';
import { withRetry, computeBackoff } from '../src/retry.js';
import {
  DeadlineExceededError,
  ServerError,
  ValidationError,
} from '../src/errors.js';

describe('computeBackoff', () => {
  it('grows exponentially (capped at max)', () => {
    // With full jitter, value is in [0, 2^attempt * base]
    for (let i = 0; i < 5; i++) {
      const val = computeBackoff(i, 100, 10_000);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(Math.min(10_000, 100 * 2 ** i));
    }
  });

  it('never exceeds maxDelayMs', () => {
    for (let i = 0; i < 20; i++) {
      expect(computeBackoff(i, 100, 500)).toBeLessThanOrEqual(500);
    }
  });
});

describe('withRetry', () => {
  it('returns immediately on first-attempt success', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(attempts).toBe(1);
  });

  it('retries retryable errors up to maxAttempts', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new ServerError({ message: 'boom' });
        },
        { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 }
      )
    ).rejects.toBeInstanceOf(ServerError);
    expect(attempts).toBe(3);
  });

  it('does NOT retry non-retryable errors', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new ValidationError({ message: 'bad' });
        },
        { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 2 }
      )
    ).rejects.toBeInstanceOf(ValidationError);
    expect(attempts).toBe(1);
  });

  it('throws DeadlineExceededError if deadline is in the past', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          return 'never';
        },
        { deadline: Date.now() - 1000 }
      )
    ).rejects.toBeInstanceOf(DeadlineExceededError);
    expect(attempts).toBe(0);
  });

  it('recovers on success after some retryable failures', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new ServerError({ message: 'boom' });
        return 'finally';
      },
      { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 2 }
    );
    expect(result).toBe('finally');
    expect(attempts).toBe(3);
  });

  it('propagates non-CommerceHubError without retrying', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error('unexpected');
        },
        { maxAttempts: 3 }
      )
    ).rejects.toThrow('unexpected');
    expect(attempts).toBe(1);
  });
});
