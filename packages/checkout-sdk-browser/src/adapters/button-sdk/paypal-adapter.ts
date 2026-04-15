/**
 * PayPal — REAL hero adapter (v2.1).
 *
 * Pattern: button-sdk (extends ButtonSdkAdapterBase)
 * Region:  Global
 * Spec:    https://developer.paypal.com/sdk/js/reference/
 *
 * Real-SDK pattern. This file is copy-paste-ready reference code for engineers
 * integrating PayPal via Commerce Hub. The PayPal Buttons SDK is loaded from
 * `https://www.paypal.com/sdk/js?client-id=...&components=buttons,messages`,
 * the merchant's container is mounted with `paypal.Buttons({...}).render(container)`,
 * and on user approval the `onApprove` callback fires with `{ orderID, payerID }`.
 *
 * Flow:
 *   1. STEP 1 — load PayPal SDK with the providerClientToken (= PayPal client-id)
 *               from the merchant backend's POST /v2/sessions
 *   2. STEP 2 — call `window.paypal.Buttons({ createOrder, onApprove, onCancel, onError }).render(container)`
 *   3. STEP 3 — `createOrder` calls back to merchant backend to create the
 *               PayPal order (under the hood, the merchant backend calls CH
 *               which calls PayPal). Returns the `orderID` PayPal provides.
 *   4. STEP 4 — User clicks PayPal button → opens PayPal popup/lightbox →
 *               approves payment → `onApprove({ orderID, payerID })` fires
 *   5. STEP 5 — Forward `{ orderID, payerID }` to merchant backend via
 *               sessionClient.authorizeOrder, which calls CH /checkouts/v1/orders
 *               to capture the PayPal order
 *
 * Merchant-initiated capture: PayPal supports separate auth and capture.
 * `paymentInitiator='MERCHANT'` does the auth via this flow, then the merchant
 * calls `checkout.capture()` later (within PayPal's 3-day auth honor window).
 */

import type { AdapterCapabilities } from '@commercehub/shared-types';
import {
  defaultCallbacks,
  defaultInteractive,
} from '@commercehub/shared-types';

import { ButtonSdkAdapterBase } from '../base/button-sdk-base.js';
import type { ButtonSdkToken } from '../base/provider-token.js';
import { loadScript, ScriptLoadError } from '../../core/load-script.js';

// ──────────────────── Provider SDK type definitions ────────────────────

interface PayPalShippingChangeData {
  orderID: string;
  shipping_address?: {
    city?: string;
    state?: string;
    postal_code?: string;
    country_code?: string;
  };
}

interface PayPalApproveData {
  orderID: string;
  payerID?: string;
  paymentID?: string;
  facilitatorAccessToken?: string;
}

interface PayPalActions {
  order?: {
    capture?: () => Promise<unknown>;
  };
  reject?: () => Promise<void>;
  resolve?: () => Promise<void>;
}

interface PayPalButtonsOptions {
  createOrder: () => Promise<string>;
  onApprove: (data: PayPalApproveData, actions: PayPalActions) => Promise<void>;
  onCancel?: (data: { orderID: string }) => void;
  onError?: (err: unknown) => void;
  onShippingChange?: (data: PayPalShippingChangeData, actions: PayPalActions) => Promise<void>;
  style?: {
    layout?: 'vertical' | 'horizontal';
    color?: 'gold' | 'blue' | 'silver' | 'white' | 'black';
    shape?: 'rect' | 'pill';
    label?: 'paypal' | 'checkout' | 'pay' | 'buynow';
  };
}

interface PayPalGlobal {
  Buttons(options: PayPalButtonsOptions): {
    isEligible: () => boolean;
    render: (container: string | HTMLElement) => Promise<void>;
  };
}

declare global {
  interface Window {
    paypal?: PayPalGlobal;
  }
}

const PAYPAL_GLOBAL = 'paypal';

// ──────────────────── Adapter ────────────────────

export class PayPalAdapter extends ButtonSdkAdapterBase {
  readonly id = 'paypal';
  readonly displayName = 'PayPal';
  readonly pattern = 'redirect-wallet' as const;

  private buttonsInstance?: ReturnType<PayPalGlobal['Buttons']>;

  static readonly capabilities: AdapterCapabilities = {
    pattern: 'button-sdk',
    displayName: 'PayPal',
    region: 'Global',
    callbacks: defaultCallbacks('button-sdk'),
    sdk: {
      requiresClientScript: true,
      // CDN URL is built dynamically with client-id query param at load time.
      cdnUrl: 'https://www.paypal.com/sdk/js',
      globalVariable: PAYPAL_GLOBAL,
      providerSdkVersion: 'v5',
    },
    ui: {
      providesButton: true, // PayPal renders its own button widget
      providesIcon: true,
      providesBrandedColors: true,
      requiresMerchantCapabilityCheck: false,
      requiresDomainVerification: false,
    },
    handoff: {
      requiresMerchantValidation: false,
      requiresWebhook: true, // for async dispute/refund updates
    },
    bnpl: {
      providesPromoWidget: false, // PayPal Pay Later is a separate adapter
      providesPriceTagMessaging: false,
      paymentTimeoutBudgetMs: 30 * 60 * 1000,
      authHoldTTLMs: 3 * 24 * 60 * 60 * 1000, // 3 day auth, 29 day honor
    },
    interactive: {
      ...defaultInteractive(),
      onShippingAddressChange: true, // PayPal supports onShippingChange
      onShippingMethodChange: true,
      callbackDeadlineMs: 10000,
    },
    intents: {
      supportsGatewayInitiated: true,
      supportsMerchantInitiated: true,
      supportsSeparateCapture: true,
      supportsVoid: true,
      supportsRefund: true,
      supportsPartialCapture: true,
      defaultInitiator: 'GATEWAY',
    },
    token: {
      singleUse: false, // PayPal orderID is reusable within session
      tokenTTLMs: 3 * 60 * 60 * 1000, // 3 hours
    },
    eligibility: {
      supportedCurrencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'MXN', 'BRL'],
      supportedCountries: [], // PayPal supports 200+ countries
      supportedLocales: ['en-US', 'en-GB', 'es-ES', 'fr-FR', 'de-DE', 'pt-BR'],
    },
    csp: {
      scriptOrigins: ['https://www.paypal.com', 'https://www.paypalobjects.com'],
      frameOrigins: ['https://www.paypal.com', 'https://www.sandbox.paypal.com'],
      connectOrigins: ['https://www.paypal.com', 'https://api-m.paypal.com'],
    },
    amountTransform: 'PASSTHROUGH', // PayPal uses decimal numbers natively
  };

  // ──────────────────── lifecycle ────────────────────

  /** STEP 1 — Load the PayPal Buttons SDK with the client-id from the session. */
  override async loadSDK(): Promise<void> {
    const clientId = this.config.credentials.providerClientToken;
    if (!clientId) {
      throw new Error(
        'PayPal requires `credentials.providerClientToken` (= PayPal client-id) ' +
          'from the merchant backend POST /v2/sessions.'
      );
    }
    const url =
      `https://www.paypal.com/sdk/js` +
      `?client-id=${encodeURIComponent(clientId)}` +
      `&currency=${encodeURIComponent(this.config.amount.currency)}` +
      `&intent=${(this.config.adapterOptions?.paymentInitiator as string) === 'MERCHANT' ? 'authorize' : 'capture'}` +
      `&components=buttons,messages`;

    try {
      await loadScript({
        url,
        globalCheck: () => typeof window !== 'undefined' && !!window.paypal,
        crossOrigin: 'anonymous',
        timeoutMs: 15000,
      });
    } catch (err) {
      if (err instanceof ScriptLoadError) throw err;
      throw new ScriptLoadError(url, err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * STEP 2 — Mount the PayPal button widget.
   * Wires onApprove → resolveTokenization, onCancel/onError → rejectTokenization.
   */
  protected async mountButton(containerId: string): Promise<void> {
    if (typeof window === 'undefined' || !window.paypal) {
      throw new Error('PayPal SDK not available — loadSDK() must run first');
    }

    this.buttonsInstance = window.paypal.Buttons({
      style: {
        layout: 'vertical',
        color: 'gold',
        shape: 'rect',
        label: 'paypal',
      },

      // STEP 3 — createOrder: ask the merchant backend to create a PayPal order
      // via CH. The backend returns the PayPal orderID which the SDK uses to
      // open the PayPal popup.
      createOrder: async (): Promise<string> => {
        const result = await this.ctx.sessionClient.authorizeOrder({
          apm: 'paypal',
          merchantOrderId: this.config.merchantOrderId,
          amount: this.config.amount,
          providerData: { intent: 'create_order' },
          intent: 'AUTHORIZE',
        } as Parameters<typeof this.ctx.sessionClient.authorizeOrder>[0]);

        // The merchant backend's response includes the PayPal orderID in providerReference.
        // For the v2.1 hero we extract it from the OrderResult.
        const ppOrderId = result.providerReference ?? result.orderId;
        if (!ppOrderId) {
          throw new Error('PayPal createOrder: backend did not return providerReference');
        }
        return ppOrderId;
      },

      // STEP 4 — onApprove: user clicked Pay in the PayPal popup. We have the
      // orderID + payerID. Resolve the tokenization promise so doAuthorize()
      // can forward to the backend for capture.
      onApprove: async (data: PayPalApproveData): Promise<void> => {
        const token: ButtonSdkToken = {
          kind: 'button-sdk',
          provider: 'paypal',
          payload: {
            orderID: data.orderID,
            payerID: data.payerID,
          },
        };
        this.resolveTokenization(token);
      },

      onCancel: () => {
        this.rejectTokenization('User cancelled PayPal payment');
      },

      onError: (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.rejectTokenization(`PayPal SDK error: ${message}`);
      },

      // STEP 4b (v2.1 interactive callback) — onShippingChange.
      // Real merchants would recompute totals here. The v2.1 InteractiveCallbackBus
      // wires this through to `config.callbacks.onShippingAddressChange` if set.
      onShippingChange: async (
        data: PayPalShippingChangeData,
        actions: PayPalActions
      ): Promise<void> => {
        const callback = this.config.adapterOptions as
          | { onShippingChange?: (addr: unknown) => Promise<void> }
          | undefined;
        if (callback?.onShippingChange) {
          await callback.onShippingChange(data.shipping_address);
        }
        // No actions.reject() = accept the address.
        return actions.resolve?.();
      },
    });

    if (!this.buttonsInstance.isEligible()) {
      throw new Error('PayPal is not eligible for this configuration (currency/country mismatch)');
    }

    await this.buttonsInstance.render(`#${containerId}`);
  }

  protected override async doTeardown(): Promise<void> {
    // PayPal's Buttons instance has no explicit teardown; the iframe is removed
    // when the container is detached. Drop the reference to allow GC.
    this.buttonsInstance = undefined;
  }

  // ──────────────────── merchant-initiated capture/void ────────────────────

  async capture(): Promise<void> {
    const refId = this.captureContext.referenceTransactionId;
    const orderId = this.captureContext.orderId;
    if (!refId || !orderId) {
      throw new Error(
        'PayPal.capture() called before awaiting_merchant_capture state — no referenceTransactionId'
      );
    }
    this.sm.transition('capturing');
    try {
      const result = await this.ctx.sessionClient.captureOrder(orderId, {
        referenceTransactionId: refId,
        amount: this.config.amount,
      });
      if (result.status === 'authorized' || result.status === 'captured') {
        this.emitter.setContext({ orderResult: result });
        this.sm.transition('completed');
      } else {
        this.emitter.setContext({
          error: result.error ?? { code: 'PROVIDER_REJECTED', message: 'PayPal capture failed' },
        });
        this.sm.transition('failed');
      }
    } catch (err) {
      this.emitter.setContext({
        error: { code: 'NETWORK_ERROR', message: err instanceof Error ? err.message : String(err) },
      });
      this.sm.transition('failed');
      throw err;
    }
  }

  async void(reason = 'merchant cancelled'): Promise<void> {
    const refId = this.captureContext.referenceTransactionId;
    const orderId = this.captureContext.orderId;
    if (!refId || !orderId) {
      throw new Error('PayPal.void() called outside of awaiting_merchant_capture / pending state');
    }
    try {
      await this.ctx.sessionClient.voidOrder(orderId, { referenceTransactionId: refId, reason });
    } finally {
      this.emitter.setContext({ cancellationReason: reason });
      this.sm.transition('cancelled');
    }
  }

  private get captureContext(): { referenceTransactionId?: string; orderId?: string } {
    const opts = this.config.adapterOptions as
      | { referenceTransactionId?: string; orderId?: string }
      | undefined;
    return {
      referenceTransactionId: opts?.referenceTransactionId,
      orderId: opts?.orderId,
    };
  }
}
