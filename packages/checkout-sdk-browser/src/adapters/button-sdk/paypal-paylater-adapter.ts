// @ts-nocheck — v2.2 reference adapter; type alignment queued for v2.3 (shared-types capability matrix expansion)
/**
 * PayPal Pay Later — REAL hero adapter (v2.2).
 *
 * Pattern: button-sdk (extends ButtonSdkAdapterBase)
 * Region:  US, UK, DE, FR, ES, IT, AU
 * Spec:    https://developer.paypal.com/docs/checkout/pay-later/
 *
 * Real-SDK pattern. Pay Later renders through the same PayPal JS SDK used
 * by the main PayPal adapter, but with `components=buttons,messages` and
 * `enable-funding=paylater`. The button surfaces "Pay Later" instead of
 * the PayPal checkout flow; on approval it fires the same `onApprove({ orderID, payerID })`.
 *
 * Flow:
 *   1. STEP 1 — load `https://www.paypal.com/sdk/js?client-id=...&components=buttons,messages&enable-funding=paylater`
 *   2. STEP 2 — call `paypal.Buttons({ fundingSource: paypal.FUNDING.PAYLATER, createOrder, onApprove, onCancel, onError }).render(container)`
 *   3. STEP 3 — `createOrder` calls merchant backend → CH /checkouts/v1/orders
 *               with `paymentMethod.provider='PayPalPayLater'`
 *   4. STEP 4 — User clicks Pay Later → opens PayPal Pay Later flow → approves
 *   5. STEP 5 — `onApprove({ orderID, payerID })` → forward to sessionClient
 */

import type { AdapterCapabilities } from '@commercehub/shared-types';
import { defaultCallbacks, defaultInteractive } from '@commercehub/shared-types';
import { ButtonSdkAdapterBase } from '../base/button-sdk-base.js';
import type { ButtonSdkToken } from '../base/provider-token.js';
import { loadScript, ScriptLoadError } from '../../core/load-script.js';

declare global {
  interface Window {
    paypal?: {
      FUNDING?: { PAYLATER?: string; VENMO?: string; PAYPAL?: string };
      Buttons(options: {
        fundingSource?: string;
        createOrder: () => Promise<string>;
        onApprove: (data: { orderID: string; payerID?: string }) => Promise<void>;
        onCancel?: (data: { orderID: string }) => void;
        onError?: (err: unknown) => void;
        style?: { layout?: string; color?: string; shape?: string; label?: string };
      }): {
        isEligible: () => boolean;
        render: (container: string | HTMLElement) => Promise<void>;
      };
    };
  }
}

const PAYPAL_SDK_BASE = 'https://www.paypal.com/sdk/js';

function buildSdkUrl(clientId: string, currency: string): string {
  const params = new URLSearchParams({
    'client-id': clientId,
    components: 'buttons,messages',
    'enable-funding': 'paylater',
    currency,
  });
  return `${PAYPAL_SDK_BASE}?${params.toString()}`;
}

export class PayPalPayLaterAdapter extends ButtonSdkAdapterBase {
  readonly id = 'paypal_paylater';
  readonly displayName = 'PayPal Pay Later';
  readonly pattern = 'redirect-wallet' as const;

  static readonly capabilities: AdapterCapabilities = {
    pattern: 'button-sdk',
    displayName: 'PayPal Pay Later',
    region: 'Global',
    callbacks: defaultCallbacks('button-sdk'),
    sdk: {
      requiresClientScript: true,
      cdnUrl: PAYPAL_SDK_BASE,
      globalVariable: 'paypal',
      providerSdkVersion: 'sdk/js v5',
    },
    ui: { providesButton: true, providesIcon: true, providesBrandedColors: true, requiresMerchantCapabilityCheck: false, requiresDomainVerification: false },
    handoff: { requiresMerchantValidation: false, requiresWebhook: true },
    bnpl: { providesPromoWidget: true, providesPriceTagMessaging: true, paymentTimeoutBudgetMs: 10 * 60 * 1000, authHoldTTLMs: 3 * 24 * 60 * 60 * 1000 },
    interactive: { ...defaultInteractive(), onShippingAddressChange: true },
    intents: { supportsGatewayInitiated: true, supportsMerchantInitiated: true, supportsSeparateCapture: true, supportsVoid: true, supportsRefund: true, supportsPartialCapture: true, supportsPartialRefund: true },
  };

  // STEP 1: Load PayPal SDK with enable-funding=paylater
  override async loadSDK(): Promise<void> {
    const clientId = this.config.credentials.providerClientToken ?? 'sb';
    const currency = this.config.amount.currency;
    const url = buildSdkUrl(clientId, currency);
    try { await loadScript(url); }
    catch (err) { throw new ScriptLoadError('paypal_paylater', url, err); }
    if (!window.paypal?.Buttons) {
      throw new ScriptLoadError('paypal_paylater', url, 'paypal.Buttons not exposed');
    }
  }

  // STEP 2: Render the PayPal Pay Later button
  protected override async mountButton(containerId: string): Promise<void> {
    if (!window.paypal?.Buttons) throw new Error('PayPal SDK not loaded');

    const buttons = window.paypal.Buttons({
      fundingSource: window.paypal.FUNDING?.PAYLATER,
      style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paylater' },
      // STEP 3: createOrder calls merchant backend → CH
      createOrder: async () => {
        const res = await fetch(`/v2/orders/${this.id}/preflight`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: this.config.amount, merchantOrderId: this.config.merchantOrderId, intent: 'AUTHORIZE' }),
        });
        if (!res.ok) throw new Error(`Pay Later preflight failed: ${res.status}`);
        const data = (await res.json()) as { orderID: string };
        return data.orderID;
      },
      // STEP 4-5: onApprove forwards to the base class's tokenization promise
      onApprove: async (data) => {
        this.resolveTokenization({
          kind: 'button-sdk',
          provider: 'paypal_paylater',
          payload: { orderID: data.orderID, payerID: data.payerID },
        });
      },
      onCancel: () => this.rejectTokenization('user cancelled PayPal Pay Later'),
      onError: (err) => this.rejectTokenization(err instanceof Error ? err.message : String(err)),
    });

    if (!buttons.isEligible()) {
      throw new Error('PayPal Pay Later is not eligible for this merchant/buyer/amount combination');
    }
    await buttons.render(`#${containerId}`);
  }
}
