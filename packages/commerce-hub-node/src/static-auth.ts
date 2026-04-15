/**
 * Static access-token authentication (POC path).
 *
 * This is the ONLY authentication mode currently implemented.
 * HMAC signing is stubbed in hmac.ts and will throw.
 *
 * Defense-in-depth refuse-production tripwire:
 * If NODE_ENV=production when StaticAuth is constructed, we throw
 * immediately. A merchant who bypasses the reference server and
 * imports @commercehub/node directly still hits this check.
 *
 * This is layer 2 of 4 refuse-production layers:
 *   1. reference-server env.ts boot check
 *   2. THIS FILE — constructor guard
 *   3. CH_BASE_URL host allowlist validator
 *   4. npm dist-tag `@poc` gate
 */

import { RefusedProductionError } from './errors.js';

export interface StaticAuthConfig {
  apiKey: string;
  /** Long-lived bearer token obtained from the Commerce Hub sandbox portal. */
  staticAccessToken: string;
  /**
   * Escape hatch for unit tests. MUST NEVER be passed in production code.
   * @internal
   */
  __allowProductionForTests?: boolean;
}

export class StaticAuth {
  readonly apiKey: string;
  private readonly staticAccessToken: string;

  constructor(config: StaticAuthConfig) {
    if (
      process.env.NODE_ENV === 'production' &&
      !config.__allowProductionForTests
    ) {
      throw new RefusedProductionError(
        'StaticAuth refuses to construct when NODE_ENV=production. ' +
          'Static access-token authentication is a POC-only path. ' +
          'Implement HMAC signing in hmac.ts before deploying to production. ' +
          'See docs/SECURITY.md for the upgrade path.'
      );
    }
    if (!config.apiKey) {
      throw new Error('StaticAuth: apiKey is required');
    }
    if (!config.staticAccessToken) {
      throw new Error('StaticAuth: staticAccessToken is required');
    }
    this.apiKey = config.apiKey;
    this.staticAccessToken = config.staticAccessToken;
  }

  /**
   * Build the Commerce Hub auth headers for a single request.
   * Called per-request so env rotation is restart-free.
   */
  buildHeaders(clientRequestId: string): Record<string, string> {
    return {
      'Api-Key': this.apiKey,
      Timestamp: String(Date.now()),
      'Auth-Token-Type': 'AccessToken',
      Authorization: `Bearer ${this.staticAccessToken}`,
      'Client-Request-Id': clientRequestId,
    };
  }
}
