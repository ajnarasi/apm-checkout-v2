/**
 * OrderResultCache test — first-writer-wins precedence (architect P0 #7).
 *
 * Validates the rule: when a sync HTTP response and an async webhook race to
 * report a terminal state for the same session, the FIRST arriver becomes
 * canonical. Subsequent writes for the same sessionId are silently ignored.
 */

import { describe, expect, it } from 'vitest';
import { OrderResultCache } from '../src/core/order-result-cache.js';
import type { OrderResult } from '@commercehub/shared-types';

function makeResult(orderId: string): OrderResult {
  return {
    orderId,
    status: 'captured',
    nextAction: { kind: 'none' },
  };
}

describe('OrderResultCache (sync-vs-webhook precedence)', () => {
  it('first writer becomes canonical', () => {
    const cache = new OrderResultCache();
    const ok = cache.put('sess-1', makeResult('CH-1'), 'sync');
    expect(ok).toBe(true);
    const cached = cache.get('sess-1');
    expect(cached?.result.orderId).toBe('CH-1');
    expect(cached?.source).toBe('sync');
  });

  it('second writer for same session is silently ignored', () => {
    const cache = new OrderResultCache();
    cache.put('sess-1', makeResult('CH-1'), 'sync');
    const second = cache.put('sess-1', makeResult('CH-2'), 'webhook');
    expect(second).toBe(false);
    const cached = cache.get('sess-1');
    expect(cached?.result.orderId).toBe('CH-1'); // first-writer-wins
    expect(cached?.source).toBe('sync');
  });

  it('webhook arriving first wins over later sync response', () => {
    const cache = new OrderResultCache();
    cache.put('sess-1', makeResult('CH-W'), 'webhook');
    cache.put('sess-1', makeResult('CH-S'), 'sync');
    const cached = cache.get('sess-1');
    expect(cached?.result.orderId).toBe('CH-W');
    expect(cached?.source).toBe('webhook');
  });

  it('different sessions have independent canonical entries', () => {
    const cache = new OrderResultCache();
    cache.put('sess-1', makeResult('CH-1'), 'sync');
    cache.put('sess-2', makeResult('CH-2'), 'webhook');
    expect(cache.get('sess-1')?.result.orderId).toBe('CH-1');
    expect(cache.get('sess-2')?.result.orderId).toBe('CH-2');
  });

  it('TTL eviction allows a new write after expiry', () => {
    let now = 1_000_000;
    const cache = new OrderResultCache({
      ttlMs: 100,
      now: () => now,
    });
    cache.put('sess-1', makeResult('CH-1'), 'sync');
    expect(cache.has('sess-1')).toBe(true);
    now += 200;
    expect(cache.has('sess-1')).toBe(false);
    const second = cache.put('sess-1', makeResult('CH-2'), 'webhook');
    expect(second).toBe(true);
    expect(cache.get('sess-1')?.result.orderId).toBe('CH-2');
  });

  it('clear removes a session entry explicitly', () => {
    const cache = new OrderResultCache();
    cache.put('sess-1', makeResult('CH-1'), 'sync');
    cache.clear('sess-1');
    expect(cache.has('sess-1')).toBe(false);
  });
});
