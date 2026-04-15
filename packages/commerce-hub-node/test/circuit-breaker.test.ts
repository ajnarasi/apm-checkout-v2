import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../src/circuit-breaker.js';
import { CircuitOpenError, CommerceHubError, ServerError, ValidationError } from '../src/errors.js';

function mockClock() {
  let now = 1_000_000;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('CircuitBreaker', () => {
  it('starts closed', () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe('closed');
  });

  it('passes successful calls through', async () => {
    const cb = new CircuitBreaker();
    const result = await cb.execute(async () => 42);
    expect(result).toBe(42);
    expect(cb.getState()).toBe('closed');
  });

  it('opens after N consecutive retryable failures', async () => {
    const clock = mockClock();
    const cb = new CircuitBreaker({ failureThreshold: 3, now: clock.now });
    for (let i = 0; i < 3; i++) {
      await expect(
        cb.execute(async () => {
          throw new ServerError({ message: 'boom' });
        })
      ).rejects.toBeInstanceOf(ServerError);
    }
    expect(cb.getState()).toBe('open');
  });

  it('fails fast with CircuitOpenError when open', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    // Trip it
    await expect(
      cb.execute(async () => {
        throw new ServerError({ message: 'boom' });
      })
    ).rejects.toBeInstanceOf(ServerError);

    // Next call fails fast
    let innerCalled = false;
    await expect(
      cb.execute(async () => {
        innerCalled = true;
        return 1;
      })
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(innerCalled).toBe(false);
  });

  it('does NOT count non-retryable errors as breaker failures', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2 });
    for (let i = 0; i < 5; i++) {
      await expect(
        cb.execute(async () => {
          throw new ValidationError({ message: 'bad' });
        })
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(cb.getState()).toBe('closed');
  });

  it('transitions open → half-open after cooldown', async () => {
    const clock = mockClock();
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      openDurationMs: 5000,
      now: clock.now,
    });

    await expect(
      cb.execute(async () => {
        throw new ServerError({ message: 'boom' });
      })
    ).rejects.toBeInstanceOf(ServerError);
    expect(cb.getState()).toBe('open');

    clock.advance(5001);
    expect(cb.getState()).toBe('half-open');
  });

  it('closes after a successful half-open trial', async () => {
    const clock = mockClock();
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      openDurationMs: 1000,
      now: clock.now,
    });

    await expect(
      cb.execute(async () => {
        throw new ServerError({ message: 'boom' });
      })
    ).rejects.toBeInstanceOf(ServerError);

    clock.advance(1500);
    const result = await cb.execute(async () => 'ok');
    expect(result).toBe('ok');
    expect(cb.getState()).toBe('closed');
  });

  it('reopens if half-open trial fails', async () => {
    const clock = mockClock();
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      openDurationMs: 1000,
      now: clock.now,
    });

    await expect(
      cb.execute(async () => {
        throw new ServerError({ message: 'boom' });
      })
    ).rejects.toBeInstanceOf(ServerError);

    clock.advance(1500);
    await expect(
      cb.execute(async () => {
        throw new ServerError({ message: 'still bad' });
      })
    ).rejects.toBeInstanceOf(ServerError);

    expect(cb.getState()).toBe('open');
  });

  it('reset() returns to closed state', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    await expect(
      cb.execute(async () => {
        throw new ServerError({ message: 'boom' });
      })
    ).rejects.toBeInstanceOf(ServerError);
    expect(cb.getState()).toBe('open');

    cb.reset();
    expect(cb.getState()).toBe('closed');
  });

  it('propagates non-CommerceHubError unchanged', async () => {
    const cb = new CircuitBreaker();
    await expect(
      cb.execute(async () => {
        throw new Error('random');
      })
    ).rejects.toThrow('random');
  });
});
