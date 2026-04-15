/**
 * Redis-backed token cache — STUB.
 *
 * Production multi-instance deployments need a shared cache so two pods
 * don't double Commerce Hub load. The interface is defined here so the
 * CommerceHubClient code path is stable across POC → production.
 *
 * Implementation is deferred to v2.1. The stub throws on all operations
 * so accidental wiring is immediately visible.
 *
 * When implementing:
 *   1. Add `ioredis` to package.json dependencies
 *   2. Implement the `TokenCache` interface below
 *   3. Add a test/redis-cache.test.ts using `ioredis-mock`
 *   4. Document in OBSERVABILITY.md and INTEGRATION_GUIDE.md
 */

import type { TokenCache } from './token-cache.js';
import { NotImplementedError } from './errors.js';

export interface RedisTokenCacheConfig {
  /** Redis connection URL, e.g. `redis://localhost:6379`. */
  url: string;
  /** Key prefix to namespace this SDK's keys. Default: `commercehub:token:`. */
  keyPrefix?: string;
}

export class RedisTokenCache<T = string> implements TokenCache<T> {
  constructor(_config: RedisTokenCacheConfig) {
    throw new NotImplementedError(
      'RedisTokenCache is not implemented in the POC release. ' +
        'Use InMemoryTokenCache for single-instance deployments. ' +
        'See src/redis-cache.ts for the implementation point.'
    );
  }

  async get(_key: string): Promise<T | undefined> {
    throw new NotImplementedError('RedisTokenCache.get not implemented');
  }

  async set(_key: string, _value: T, _ttlMs: number): Promise<void> {
    throw new NotImplementedError('RedisTokenCache.set not implemented');
  }

  async delete(_key: string): Promise<void> {
    throw new NotImplementedError('RedisTokenCache.delete not implemented');
  }

  async clear(): Promise<void> {
    throw new NotImplementedError('RedisTokenCache.clear not implemented');
  }
}
