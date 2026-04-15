import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/event-bus.js';

interface E {
  type: string;
  payload?: number;
}

describe('EventBus', () => {
  it('delivers events to specific listeners', async () => {
    const bus = new EventBus<E>();
    const seen: number[] = [];
    bus.on('A', (e) => seen.push(e.payload ?? 0));
    await bus.emit({ type: 'A', payload: 1 });
    await bus.emit({ type: 'B', payload: 2 });
    expect(seen).toEqual([1]);
  });

  it('onAny receives every event', async () => {
    const bus = new EventBus<E>();
    const seen: string[] = [];
    bus.onAny((e) => seen.push(e.type));
    await bus.emit({ type: 'A' });
    await bus.emit({ type: 'B' });
    expect(seen).toEqual(['A', 'B']);
  });

  it('returned unsubscribe stops further delivery', async () => {
    const bus = new EventBus<E>();
    let count = 0;
    const unsub = bus.on('A', () => count++);
    await bus.emit({ type: 'A' });
    unsub();
    await bus.emit({ type: 'A' });
    expect(count).toBe(1);
  });

  it('listener errors do not block other listeners', async () => {
    const bus = new EventBus<E>();
    let saw = false;
    bus.on('A', () => {
      throw new Error('listener boom');
    });
    bus.on('A', () => {
      saw = true;
    });
    await bus.emit({ type: 'A' });
    expect(saw).toBe(true);
  });

  it('clear removes all listeners', async () => {
    const bus = new EventBus<E>();
    let count = 0;
    bus.on('A', () => count++);
    bus.onAny(() => count++);
    bus.clear();
    await bus.emit({ type: 'A' });
    expect(count).toBe(0);
  });
});
