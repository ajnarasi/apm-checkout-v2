/**
 * OrderResultCache — sync-vs-webhook precedence cache.
 *
 * Architect Pass #2 P0 #7: "Sync response vs webhook precedence rule —
 * first-writer-wins keyed on sessionId, state machine tolerates out-of-order
 * arrival."
 *
 * Both the sync HTTP response handler and the WebhookListener can race to
 * report a terminal state for the same session. This cache records the FIRST
 * canonical OrderResult to arrive and ignores subsequent writes. Both code
 * paths read+write through it so the merchant frontend always sees a consistent
 * snapshot regardless of arrival order.
 *
 * The state machine itself enforces no-duplicate emission via self-transition
 * no-ops; this cache is the read-side companion that ensures whoever asks
 * "what's the current OrderResult for this session?" always sees the same
 * answer.
 *
 * In-memory only. For multi-instance reference servers, a Redis-backed impl
 * matching this interface would be a v2.2 addition.
 */

import type { OrderResult } from '@commercehub/shared-types';

export type ResultSource = 'sync' | 'webhook' | 'polling' | 'capture' | 'void';

export interface CachedOrderResult {
  result: OrderResult;
  source: ResultSource;
  /** Unix epoch ms of the first write. */
  firstWriteAt: number;
}

export interface OrderResultCacheConfig {
  /** Per-session max age for cache entries. Default 30 minutes. */
  ttlMs?: number;
  /** Clock — injectable for tests. */
  now?: () => number;
}

export class OrderResultCache {
  private readonly entries = new Map<string, CachedOrderResult>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(config: OrderResultCacheConfig = {}) {
    this.ttlMs = config.ttlMs ?? 30 * 60 * 1000;
    this.now = config.now ?? Date.now;
  }

  /**
   * First-writer-wins. Subsequent writes for the same sessionId are silently
   * ignored — the first arriver's OrderResult is canonical.
   *
   * Returns true if this write became canonical, false if a prior write existed.
   */
  put(sessionId: string, result: OrderResult, source: ResultSource): boolean {
    const existing = this.entries.get(sessionId);
    if (existing && this.now() - existing.firstWriteAt < this.ttlMs) {
      return false;
    }
    this.entries.set(sessionId, {
      result,
      source,
      firstWriteAt: this.now(),
    });
    return true;
  }

  get(sessionId: string): CachedOrderResult | undefined {
    const entry = this.entries.get(sessionId);
    if (!entry) return undefined;
    if (this.now() - entry.firstWriteAt >= this.ttlMs) {
      this.entries.delete(sessionId);
      return undefined;
    }
    return entry;
  }

  has(sessionId: string): boolean {
    return this.get(sessionId) !== undefined;
  }

  clear(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  /** Test helper. */
  size(): number {
    return this.entries.size;
  }
}
