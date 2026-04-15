/**
 * HMAC-SHA256 request signing — STUB.
 *
 * Production-ready implementation is NOT included in the POC.
 * When HMAC ships:
 *   1. Implement sign() below per Fiserv's signing guide
 *   2. Remove the `@poc` dist-tag from package.json
 *   3. Remove the RefusedProductionError throw in static-auth.ts
 *   4. Update docs/SECURITY.md to reflect the new auth path
 *   5. Add HMAC vector tests to test/hmac.test.ts
 *
 * The exact concatenation order for the signing payload is NOT in the
 * pages of the Credentials spec that have been reviewed. It follows
 * Fiserv's general convention but MUST be verified against their
 * signing guide before production use.
 *
 * Expected signing formula (convention, NOT verified):
 *   base64(HMAC-SHA256(
 *     apiSecret,
 *     apiKey + clientRequestId + timestamp + requestBody
 *   ))
 */

import { NotImplementedError } from './errors.js';

export interface HmacSignInput {
  apiKey: string;
  apiSecret: string;
  clientRequestId: string;
  timestamp: number;
  requestBody: string;
}

/**
 * Sign a Commerce Hub request with HMAC-SHA256.
 *
 * @throws {NotImplementedError} Always, until HMAC support ships.
 */
export function sign(_input: HmacSignInput): string {
  throw new NotImplementedError(
    'HMAC signing is not implemented in the POC release. ' +
      'This SDK currently supports static access-token authentication only. ' +
      'See src/hmac.ts for the implementation point and docs/SECURITY.md for the upgrade path.'
  );
}

/**
 * Build the full set of HMAC auth headers for a Commerce Hub request.
 *
 * @throws {NotImplementedError} Always.
 */
export function buildHmacHeaders(_input: HmacSignInput): Record<string, string> {
  throw new NotImplementedError(
    'HMAC header construction is not implemented in the POC release.'
  );
}
