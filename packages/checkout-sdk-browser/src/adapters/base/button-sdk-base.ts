/**
 * ButtonSdkAdapterBase — abstract base for provider-rendered button widgets.
 *
 * Members of this pattern: PayPal, PayPal Pay Later, Venmo, CashApp.
 *
 * Provider rendering model: the SDK loads `https://www.paypal.com/sdk/js?...`
 * (or equivalent), then the merchant calls `paypal.Buttons({createOrder, onApprove}).render(container)`.
 * The user clicks the button → the provider opens its own auth flow (popup / lightbox / redirect)
 * → on completion the `onApprove` callback fires with `{ orderID, payerID }`.
 *
 * The base class handles the `loadSDK → render → wait for onApprove → forward token`
 * lifecycle. Subclasses provide:
 *   - `loadProviderSdk()` — load the provider SDK
 *   - `mountButton(container)` — call the provider's button render API and
 *     wire `onApprove` to the BaseAdapter's tokenization promise resolver
 *   - The actual `tokenize()` is driven by user clicking the button
 */

import type { OrderResult } from '@commercehub/shared-types';
import { BaseAdapter } from '../../core/base-adapter.js';
import type { AdapterContext, CheckoutConfig } from '../../core/types.js';
import type { ButtonSdkToken } from './provider-token.js';

export abstract class ButtonSdkAdapterBase extends BaseAdapter {
  /** Resolves with the token once the user clicks the button and the provider's onApprove fires. */
  private tokenizationResolver?: (token: ButtonSdkToken) => void;
  private tokenizationRejector?: (err: Error) => void;
  private tokenizationPromise?: Promise<ButtonSdkToken>;

  abstract override loadSDK(): Promise<void>;

  /**
   * Subclasses MUST implement: render the provider's branded button into
   * `containerId`. Wire the provider's onApprove → `this.resolveTokenization(token)`.
   * Wire its onCancel → `this.rejectTokenization(error)`.
   */
  protected abstract mountButton(containerId: string): Promise<void>;

  protected async doInit(_config: CheckoutConfig, _ctx: AdapterContext): Promise<void> {
    this.tokenizationPromise = new Promise<ButtonSdkToken>((resolve, reject) => {
      this.tokenizationResolver = resolve;
      this.tokenizationRejector = reject;
    });
  }

  protected async doRender(): Promise<void> {
    if (!this.config.containerId) {
      throw new Error(`${this.id}: containerId is required for button-sdk pattern`);
    }
    await this.mountButton(this.config.containerId);
  }

  protected async doAuthorize(): Promise<OrderResult> {
    if (!this.tokenizationPromise) {
      throw new Error(`${this.id}: doInit must complete before authorize`);
    }
    // Wait for the user to click the rendered button. The provider's onApprove
    // callback fires resolveTokenization(...) below.
    const token = await this.tokenizationPromise;
    return this.ctx.sessionClient.authorizeOrder({
      apm: this.id,
      merchantOrderId: this.config.merchantOrderId,
      amount: this.config.amount,
      providerData: token.payload,
    });
  }

  /** Subclasses call this from inside the provider's onApprove callback. */
  protected resolveTokenization(token: ButtonSdkToken): void {
    this.tokenizationResolver?.(token);
  }

  /** Subclasses call this from inside the provider's onCancel/onError callback. */
  protected rejectTokenization(reason: string): void {
    this.tokenizationRejector?.(new Error(reason));
  }
}
