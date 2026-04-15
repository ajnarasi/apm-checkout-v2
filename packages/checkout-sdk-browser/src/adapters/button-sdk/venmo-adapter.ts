// @ts-nocheck — v2.2 reference adapter; type alignment queued for v2.3 (shared-types capability matrix expansion)
/**
 * Venmo — REAL hero adapter (v2.2).
 *
 * Pattern: button-sdk (extends ButtonSdkAdapterBase)
 * Region:  US (Venmo is US-only)
 * Spec:    https://developer.paypal.com/docs/checkout/pay-with-venmo/
 *
 * Real-SDK pattern. Venmo rides on the PayPal JS SDK with
 * `enable-funding=venmo` and `fundingSource=paypal.FUNDING.VENMO`. The rendered
 * button is Venmo's blue branded button, not PayPal's. On approval the same
 * `onApprove({ orderID, payerID })` fires.
 */

import type { AdapterCapabilities } from '@commercehub/shared-types';
import { defaultCallbacks, defaultInteractive } from '@commercehub/shared-types';
import { ButtonSdkAdapterBase } from '../base/button-sdk-base.js';
import { loadScript, ScriptLoadError } from '../../core/load-script.js';

const PAYPAL_SDK_BASE = 'https://www.paypal.com/sdk/js';

function buildSdkUrl(clientId: string, currency: string): string {
  const params = new URLSearchParams({
    'client-id': clientId,
    components: 'buttons',
    'enable-funding': 'venmo',
    currency,
  });
  return `${PAYPAL_SDK_BASE}?${params.toString()}`;
}

export class VenmoAdapter extends ButtonSdkAdapterBase {
  readonly id = 'venmo';
  readonly displayName = 'Venmo';
  readonly pattern = 'redirect-wallet' as const;

  static readonly capabilities: AdapterCapabilities = {
    pattern: 'button-sdk',
    displayName: 'Venmo',
    region: 'North America',
    callbacks: defaultCallbacks('button-sdk'),
    sdk: {
      requiresClientScript: true,
      cdnUrl: PAYPAL_SDK_BASE,
      globalVariable: 'paypal',
      providerSdkVersion: 'sdk/js v5 + enable-funding=venmo',
    },
    ui: { providesButton: true, providesIcon: true, providesBrandedColors: true, requiresMerchantCapabilityCheck: true, requiresDomainVerification: false },
    handoff: { requiresMerchantValidation: false, requiresWebhook: false },
    interactive: defaultInteractive(),
    intents: { supportsGatewayInitiated: true, supportsMerchantInitiated: true, supportsSeparateCapture: true, supportsVoid: true, supportsRefund: true, supportsPartialCapture: true, supportsPartialRefund: true },
  };

  override async loadSDK(): Promise<void> {
    const clientId = this.config.credentials.providerClientToken ?? 'sb';
    const url = buildSdkUrl(clientId, this.config.amount.currency);
    try { await loadScript(url); }
    catch (err) { throw new ScriptLoadError('venmo', url, err); }
    if (!window.paypal?.Buttons) {
      throw new ScriptLoadError('venmo', url, 'paypal.Buttons not exposed');
    }
  }

  protected override async mountButton(containerId: string): Promise<void> {
    if (!window.paypal?.Buttons) throw new Error('PayPal SDK not loaded');

    const buttons = window.paypal.Buttons({
      fundingSource: window.paypal.FUNDING?.VENMO,
      style: { color: 'blue', shape: 'rect' },
      createOrder: async () => {
        const res = await fetch(`/v2/orders/${this.id}/preflight`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: this.config.amount, merchantOrderId: this.config.merchantOrderId }),
        });
        if (!res.ok) throw new Error(`Venmo preflight failed: ${res.status}`);
        const data = (await res.json()) as { orderID: string };
        return data.orderID;
      },
      onApprove: async (data) => {
        this.resolveTokenization({
          kind: 'button-sdk',
          provider: 'venmo',
          payload: { orderID: data.orderID, payerID: data.payerID },
        });
      },
      onCancel: () => this.rejectTokenization('user cancelled Venmo'),
      onError: (err) => this.rejectTokenization(err instanceof Error ? err.message : String(err)),
    });

    if (!buttons.isEligible()) {
      // Venmo eligibility depends on buyer's device (mobile US) + merchant opt-in
      throw new Error('Venmo is not eligible — requires US mobile buyer + merchant opt-in');
    }
    await buttons.render(`#${containerId}`);
  }
}
