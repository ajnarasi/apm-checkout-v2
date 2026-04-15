import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../src/webhooks/event-bus.js';

function clock() {
  let now = 1_000_000;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('InMemoryEventBus', () => {
  it('publish + subscribe delivers events to listeners', () => {
    const bus = new InMemoryEventBus();
    const seen: string[] = [];
    bus.subscribe('sess-1', (env) => seen.push(env.kind));

    bus.publish({
      sessionId: 'sess-1',
      provider: 'ch',
      kind: 'payment.succeeded',
      orderId: 'O1',
      occurredAt: 1,
    });

    expect(seen).toEqual(['payment.succeeded']);
  });

  it('only delivers to listeners on the same session', () => {
    const bus = new InMemoryEventBus();
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribe('sess-A', (e) => a.push(e.orderId));
    bus.subscribe('sess-B', (e) => b.push(e.orderId));

    bus.publish({
      sessionId: 'sess-A',
      provider: 'ch',
      kind: 'payment.succeeded',
      orderId: 'O1',
      occurredAt: 1,
    });

    expect(a).toEqual(['O1']);
    expect(b).toEqual([]);
  });

  it('replay returns events in publish order', () => {
    const bus = new InMemoryEventBus();
    bus.publish({ sessionId: 's', provider: 'ch', kind: 'payment.succeeded', orderId: 'O1', occurredAt: 1 });
    bus.publish({ sessionId: 's', provider: 'ch', kind: 'payment.succeeded', orderId: 'O2', occurredAt: 2 });
    const replayed = bus.replay('s');
    expect(replayed.map((e) => e.orderId)).toEqual(['O1', 'O2']);
  });

  it('replay since lastEventId returns only newer events', () => {
    const bus = new InMemoryEventBus();
    const e1 = bus.publish({ sessionId: 's', provider: 'ch', kind: 'payment.succeeded', orderId: 'O1', occurredAt: 1 });
    const e2 = bus.publish({ sessionId: 's', provider: 'ch', kind: 'payment.succeeded', orderId: 'O2', occurredAt: 2 });
    bus.publish({ sessionId: 's', provider: 'ch', kind: 'payment.succeeded', orderId: 'O3', occurredAt: 3 });

    const sinceE1 = bus.replay('s', e1.id);
    expect(sinceE1.map((e) => e.orderId)).toEqual(['O2', 'O3']);

    const sinceE2 = bus.replay('s', e2.id);
    expect(sinceE2.map((e) => e.orderId)).toEqual(['O3']);
  });

  it('ring buffer caps at bufferSize', () => {
    const bus = new InMemoryEventBus({ bufferSize: 3 });
    for (let i = 0; i < 5; i++) {
      bus.publish({ sessionId: 's', provider: 'ch', kind: 'payment.succeeded', orderId: `O${i}`, occurredAt: i });
    }
    const all = bus.replay('s');
    expect(all.map((e) => e.orderId)).toEqual(['O2', 'O3', 'O4']);
  });

  it('expired events are dropped on access', () => {
    const c = clock();
    const bus = new InMemoryEventBus({ ttlMs: 1000, now: c.now });
    bus.publish({ sessionId: 's', provider: 'ch', kind: 'payment.succeeded', orderId: 'O1', occurredAt: 1 });
    c.advance(1500);
    expect(bus.replay('s')).toEqual([]);
  });

  it('unsubscribe stops further deliveries', () => {
    const bus = new InMemoryEventBus();
    let count = 0;
    const unsub = bus.subscribe('s', () => count++);
    bus.publish({ sessionId: 's', provider: 'ch', kind: 'payment.succeeded', orderId: 'O1', occurredAt: 1 });
    unsub();
    bus.publish({ sessionId: 's', provider: 'ch', kind: 'payment.succeeded', orderId: 'O2', occurredAt: 2 });
    expect(count).toBe(1);
  });
});
