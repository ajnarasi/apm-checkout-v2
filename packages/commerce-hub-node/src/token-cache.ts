/**
 * Pluggable token cache with a TTL + LRU in-memory default.
 *
 * Production multi-instance deployments should use the RedisTokenCache
 * stub in redis-cache.ts (implementation deferred to v2.1).
 *
 * The cache stores session access tokens keyed by a caller-supplied
 * cache key — typically a hash of the request parameters that would
 * make two sessions equivalent. CommerceHubClient decides whether to
 * cache; this class is a pure key-value store.
 */

export interface CacheEntry<T> {
  value: T;
  /** Unix epoch ms. */
  expiresAt: number;
}

export interface TokenCache<T = string> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface InMemoryTokenCacheConfig {
  /** Max entries. Oldest-used evicted when full. Default: 1000. */
  maxEntries?: number;
  /** Clock source — injectable for tests. Default: Date.now. */
  now?: () => number;
}

/**
 * In-memory TTL + LRU cache.
 *
 * NOT suitable for multi-instance production: each pod gets its own cache,
 * doubling Commerce Hub load and halving the effective hit rate.
 * Use RedisTokenCache for multi-instance.
 */
export class InMemoryTokenCache<T = string> implements TokenCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(config: InMemoryTokenCacheConfig = {}) {
    this.maxEntries = config.maxEntries ?? 1000;
    this.now = config.now ?? Date.now;
  }

  async get(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    // LRU touch — delete and re-insert to move to the end
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  async set(key: string, value: T, ttlMs: number): Promise<void> {
    // Evict oldest if at capacity
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const firstKey = this.entries.keys().next().value;
      if (firstKey !== undefined) {
        this.entries.delete(firstKey);
      }
    }
    this.entries.set(key, {
      value,
      expiresAt: this.now() + ttlMs,
    });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }

  /** Current number of entries. Used by tests and /readyz. */
  size(): number {
    return this.entries.size;
  }
}
