import { describe, expect, it } from 'vitest';
import { InMemoryTokenCache } from '../src/token-cache.js';

function mockClock() {
  let now = 1_000_000;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('InMemoryTokenCache', () => {
  it('returns undefined for missing keys', async () => {
    const cache = new InMemoryTokenCache<string>();
    expect(await cache.get('missing')).toBeUndefined();
  });

  it('stores and retrieves values within TTL', async () => {
    const clock = mockClock();
    const cache = new InMemoryTokenCache<string>({ now: clock.now });
    await cache.set('key', 'value', 1000);
    expect(await cache.get('key')).toBe('value');
  });

  it('expires entries after TTL elapses', async () => {
    const clock = mockClock();
    const cache = new InMemoryTokenCache<string>({ now: clock.now });
    await cache.set('key', 'value', 1000);
    clock.advance(1001);
    expect(await cache.get('key')).toBeUndefined();
  });

  it('evicts LRU when capacity reached', async () => {
    const cache = new InMemoryTokenCache<string>({ maxEntries: 2 });
    await cache.set('a', '1', 60_000);
    await cache.set('b', '2', 60_000);
    await cache.set('c', '3', 60_000); // evicts 'a'

    expect(await cache.get('a')).toBeUndefined();
    expect(await cache.get('b')).toBe('2');
    expect(await cache.get('c')).toBe('3');
  });

  it('LRU-touches entries on get', async () => {
    const cache = new InMemoryTokenCache<string>({ maxEntries: 2 });
    await cache.set('a', '1', 60_000);
    await cache.set('b', '2', 60_000);
    // Touch 'a' — now 'b' is LRU
    await cache.get('a');
    await cache.set('c', '3', 60_000); // evicts 'b', not 'a'

    expect(await cache.get('a')).toBe('1');
    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('c')).toBe('3');
  });

  it('delete removes entries', async () => {
    const cache = new InMemoryTokenCache<string>();
    await cache.set('key', 'value', 1000);
    await cache.delete('key');
    expect(await cache.get('key')).toBeUndefined();
  });

  it('clear removes all entries', async () => {
    const cache = new InMemoryTokenCache<string>();
    await cache.set('a', '1', 1000);
    await cache.set('b', '2', 1000);
    await cache.clear();
    expect(cache.size()).toBe(0);
  });

  it('overwrites existing keys in place (no eviction)', async () => {
    const cache = new InMemoryTokenCache<string>({ maxEntries: 2 });
    await cache.set('a', '1', 60_000);
    await cache.set('b', '2', 60_000);
    await cache.set('a', 'new', 60_000); // overwrite, not evict

    expect(cache.size()).toBe(2);
    expect(await cache.get('a')).toBe('new');
    expect(await cache.get('b')).toBe('2');
  });
});
