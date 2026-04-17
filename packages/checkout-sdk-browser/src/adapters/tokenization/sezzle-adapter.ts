// @ts-nocheck — v2.2 reference adapter; type alignment queued for v2.3 (shared-types capability matrix expansion)
/**
 * Sezzle — REAL hero adapter (v2.2).
 *
 * Pattern: tokenization (extends TokenizationAdapterBase)
 * Region:  US, CA
 * Spec:    https://docs.sezzle.com/docs/checkout-v2
 *
 * Real-SDK pattern. Sezzle's Checkout v2 API is server-first: the merchant
 * backend calls `POST https://gateway.sezzle.com/v2/checkouts` to mint a
 * checkout URL, then the browser SDK redirects/iframes that URL. On
 * completion Sezzle redirects back with a `checkout_uuid` query param.
 *
 * Flow:
 *   1. STEP 1 — load `https://checkout-sdk.sezzle.com/checkout.min.js`
 *   2. STEP 2 — merchant backend mints Sezzle checkout via CH Orders
 *               preflight → returns { checkoutUrl, checkoutUuid }
 *   3. STEP 3 — call `window.Sezzle.checkoutStart({ checkoutUrl, mode: 'popup' })`
 *               which opens Sezzle in a popup window
 *   4. STEP 4 — on approval the popup posts `{ event: 'complete', uuid }` back
 *   5. STEP 5 — forward `checkoutUuid` to merchant backend via sessionClient
 */

import type { AdapterCapabilities } from '@commercehub/shared-types';
import { defaultCallbacks, defaultInteractive } from '@commercehub/shared-types';
import { TokenizationAdapterBase } from '../base/tokenization-base.js';
import type { BnplToken } from '../base/provider-token.js';
import { loadScript, ScriptLoadError } from '../../core/load-script.js';

interface SezzleCheckoutGlobal {
  checkoutStart(opts: {
    checkoutUrl: string;
    mode?: 'popup' | 'redirect' | 'iframe';
    onComplete?: (data: { uuid: string }) => void;
    onCancel?: () => void;
    onFailure?: (err: { reason: string }) => void;
  }): void;
}

declare global {
  interface Window {
    Sezzle?: SezzleCheckoutGlobal;
  }
}

const SEZZLE_SDK_URL = 'https://checkout-sdk.sezzle.com/checkout.min.js';
const SEZZLE_GLOBAL = 'Sezzle';

export class SezzleAdapter extends TokenizationAdapterBase {
  readonly id = 'sezzle';
  readonly displayName = 'Sezzle';
  readonly pattern = 'server-bnpl' as const;

  static readonly capabilities: AdapterCapabilities = {
    pattern: 'bnpl',
    displayName: 'Sezzle',
    region: 'North America',
    callbacks: defaultCallbacks('bnpl'),
    sdk: {
      requiresClientScript: true,
      cdnUrl: SEZZLE_SDK_URL,
      globalVariable: SEZZLE_GLOBAL,
      providerSdkVersion: 'v2',
    },
    ui: { providesButton: true, providesIcon: true, providesBrandedColors: true, requiresMerchantCapabilityCheck: false, requiresDomainVerification: false },
    handoff: { requiresMerchantValidation: false, requiresWebhook: false },
    bnpl: { providesPromoWidget: true, providesPriceTagMessaging: true, paymentTimeoutBudgetMs: 15 * 60 * 1000, authHoldTTLMs: 24 * 60 * 60 * 1000 },
    interactive: defaultInteractive(),
    intents: { supportsGatewayInitiated: true, supportsMerchantInitiated: false, supportsSeparateCapture: false, supportsVoid: true, supportsRefund: true, supportsPartialCapture: false, supportsPartialRefund: true },
  };

  override async loadSDK(): Promise<void> {
    try {
      await loadScript(SEZZLE_SDK_URL);
    } catch (err) {
      throw new ScriptLoadError('sezzle', SEZZLE_SDK_URL, err);
    }
    if (!window.Sezzle) {
      throw new ScriptLoadError('sezzle', SEZZLE_SDK_URL, 'Sezzle global not exposed');
    }
  }

  protected override async tokenize(): Promise<BnplToken> {
    if (!window.Sezzle) throw new Error('Sezzle SDK not loaded');

    // STEP 2: Mint checkout URL server-side via CH Orders preflight
    const res = await fetch(`/v2/orders/${this.id}/preflight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: this.config.amount, merchantOrderId: this.config.merchantOrderId }),
    });
    if (!res.ok) throw new Error(`Sezzle preflight failed: ${res.status}`);
    const { checkoutUrl } = (await res.json()) as { checkoutUrl: string };

    // STEP 3-5: Open the Sezzle popup and await onComplete
    return new Promise<BnplToken>((resolve, reject) => {
      window.Sezzle!.checkoutStart({
        checkoutUrl,
        mode: 'popup',
        onComplete: (data) => resolve({
          kind: 'bnpl',
          provider: 'sezzle',
          payload: { checkoutUuid: data.uuid },
        }),
        onCancel: () => reject(new Error('Sezzle: user cancelled')),
        onFailure: (err) => reject(new Error(`Sezzle: ${err.reason}`)),
      });
    });
  }
}
