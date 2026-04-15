/**
 * TokenizationAdapterBase — abstract base for BNPL APMs that load a provider
 * JS SDK and call its tokenization API to produce an authorization token.
 *
 * Members of this pattern: Klarna, Affirm, Afterpay, Sezzle, Zip.
 *
 * Real-SDK pattern enforced by the architect Pass #2 review (P0 #3): every
 * subclass MUST implement `loadProviderSdk()` (which uses the shared
 * `loadScript` helper) and `tokenize()` (which returns a `ProviderToken`).
 * The base class handles the rest of the lifecycle:
 *
 *   1. doInit  → no-op (provider SDK loads in loadSDK, not init)
 *   2. loadSDK → calls subclass.loadProviderSdk()
 *   3. doRender → optional widget mount (subclass override)
 *   4. doAuthorize → calls subclass.tokenize(), forwards token to SessionClient
 *
 * Token TTL is enforced via AdapterCapabilities.token.tokenTTLMs declared
 * co-located with the adapter. If forwarding fails after TTL elapses, the
 * single-use semantics force the user back to `ready` (architect P0 #2).
 */

import type { OrderResult } from '@commercehub/shared-types';
import { BaseAdapter } from '../../core/base-adapter.js';
import type { AdapterContext, CheckoutConfig } from '../../core/types.js';
import type { ProviderToken } from './provider-token.js';

export abstract class TokenizationAdapterBase extends BaseAdapter {
  /**
   * Subclasses MUST implement: load the provider's JS SDK from CDN.
   * Use `loadScript(...)` from `core/load-script.ts`.
   * On failure the BaseAdapter transitions to `script_load_failed`.
   */
  abstract override loadSDK(): Promise<void>;

  /**
   * Subclasses MUST implement: call the provider's tokenization API and
   * return the resulting token. This is the REAL provider SDK call —
   * `Klarna.Payments.authorize`, `affirm.checkout.open`, etc.
   *
   * The returned token is forwarded to the merchant backend's
   * `POST /v2/orders/:apm` proxy via SessionClient.
   */
  protected abstract tokenize(): Promise<ProviderToken>;

  protected async doInit(_config: CheckoutConfig, _ctx: AdapterContext): Promise<void> {
    // Tokenization adapters do their setup in loadProviderSdk; no extra init step.
  }

  protected async doAuthorize(): Promise<OrderResult> {
    const token = await this.tokenize();
    return this.ctx.sessionClient.authorizeOrder({
      apm: this.id,
      merchantOrderId: this.config.merchantOrderId,
      amount: this.config.amount,
      providerData: token.payload,
    });
  }
}
