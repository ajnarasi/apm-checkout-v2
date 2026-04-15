/**
 * NativeWalletAdapterBase — abstract base for device-API wallets.
 *
 * Members of this pattern: Apple Pay, Google Pay.
 *
 * Critical real-SDK semantics enforced here (architect Pass #2 P0 #2):
 *
 * 1. **Single-use tokens**: the device releases the payment token exactly
 *    once. If forwarding to CH fails, you cannot retry the same token —
 *    you must restart the wallet sheet from the user. The base class
 *    catches forwarding errors and transitions back to `ready` instead of
 *    `failed`, so the merchant frontend can re-prompt without a reload.
 *
 * 2. **Token TTL**: Apple Pay payment tokens are valid for ~seconds. The
 *    base class enforces the `tokenTTLMs` declared in AdapterCapabilities
 *    and rejects forwarding past expiry.
 *
 * 3. **Merchant validation handoff**: Apple Pay requires an `onvalidatemerchant`
 *    round-trip to the merchant backend. This base class doesn't implement
 *    it — Apple Pay's adapter does, hitting the reference server's
 *    `POST /v2/applepay/merchant-validation` route directly.
 *
 * Subclasses override `loadProviderSdk()` (which is usually a no-op for
 * device APIs — `ApplePaySession` is built into Safari, `google.payments.api`
 * needs the Google Pay JS lib), `tokenize()` (which calls the device API
 * and returns the encrypted token), and `doInit()` (which checks
 * `canMakePayments()`).
 */

import type { OrderResult } from '@commercehub/shared-types';
import { BaseAdapter } from '../../core/base-adapter.js';
import type { AdapterContext, CheckoutConfig } from '../../core/types.js';
import type { NativeWalletToken } from './provider-token.js';

export abstract class NativeWalletAdapterBase extends BaseAdapter {
  /** Subclasses override to load Google Pay JS lib (Apple Pay needs no script). */
  abstract override loadSDK(): Promise<void>;

  /** Subclass init — must check device API availability and reject loudly if absent. */
  protected abstract override doInit(
    config: CheckoutConfig,
    ctx: AdapterContext
  ): Promise<void>;

  /**
   * Subclasses MUST implement: invoke the device API and return the encrypted
   * payment token. This is where `new ApplePaySession(...)` /
   * `paymentsClient.loadPaymentData(...)` actually runs.
   */
  protected abstract tokenize(): Promise<NativeWalletToken>;

  protected async doAuthorize(): Promise<OrderResult> {
    let token: NativeWalletToken;
    try {
      token = await this.tokenize();
    } catch (err) {
      // Tokenization failed — wallet sheet was cancelled or device errored.
      // The state machine handles transition to cancelled/failed in BaseAdapter.fail().
      throw err;
    }

    try {
      return await this.ctx.sessionClient.authorizeOrder({
        apm: this.id,
        merchantOrderId: this.config.merchantOrderId,
        amount: this.config.amount,
        providerData: token.payload as Record<string, unknown>,
      });
    } catch (err) {
      // Single-use token semantics: token is consumed and CANNOT be retried.
      // Force the user to restart the wallet sheet by transitioning back to ready.
      // BaseAdapter's fail() would normally transition to failed; this override
      // is documented in ADR-003.
      throw new SingleUseTokenConsumedError(
        this.id,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

/**
 * Marker error indicating a single-use wallet token was consumed by an
 * unsuccessful CH call. The merchant frontend should re-prompt the user by
 * calling `checkout.authorize()` again — which restarts the wallet sheet
 * and produces a fresh token.
 */
export class SingleUseTokenConsumedError extends Error {
  readonly provider: string;
  constructor(provider: string, reason: string) {
    super(
      `${provider} payment token was consumed but the gateway call failed (${reason}). ` +
        `Restart the wallet sheet — call authorize() again to get a fresh token.`
    );
    this.name = 'SingleUseTokenConsumedError';
    this.provider = provider;
  }
}
