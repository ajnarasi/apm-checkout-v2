// @ts-nocheck — v2.2 reference adapter; type alignment queued for v2.3 (shared-types capability matrix expansion)
/**
 * Zip (formerly Quadpay) — REAL hero adapter (v2.2).
 *
 * Pattern: tokenization (extends TokenizationAdapterBase)
 * Region:  US, AU, NZ, CA
 * Spec:    https://developers.zip.co/docs/au/online-checkout/web-checkout
 *
 * Real-SDK pattern. Zip uses a server-first flow similar to Sezzle: the
 * merchant backend calls Zip's /checkouts endpoint via CH to mint a
 * checkout URL, then the browser SDK opens Zip's hosted widget.
 *
 * Flow:
 *   1. STEP 1 — load `https://static.zip.co/zip-widget/zip-widget.js`
 *   2. STEP 2 — preflight via merchant backend to mint checkout URL
 *   3. STEP 3 — call `Zip.Checkout.open({ checkoutId })`
 *   4. STEP 4 — on redirect/postMessage with `result: 'approved'`, resolve
 *               with the Zip `checkoutId` + `sessionId`
 *   5. STEP 5 — forward to sessionClient
 */

import type { AdapterCapabilities } from '@commercehub/shared-types';
import { defaultCallbacks, defaultInteractive } from '@commercehub/shared-types';
import { TokenizationAdapterBase } from '../base/tokenization-base.js';
import type { TokenizationToken } from '../base/provider-token.js';
import { loadScript, ScriptLoadError } from '../../core/load-script.js';

interface ZipCheckoutResult {
  result: 'approved' | 'cancelled' | 'declined' | 'error';
  checkoutId?: string;
  sessionId?: string;
  error?: string;
}

interface ZipGlobal {
  Checkout: {
    open(opts: {
      checkoutId: string;
      onComplete?: (result: ZipCheckoutResult) => void;
    }): void;
  };
}

declare global {
  interface Window {
    Zip?: ZipGlobal;
  }
}

const ZIP_SDK_URL = 'https://static.zip.co/zip-widget/zip-widget.js';
const ZIP_GLOBAL = 'Zip';

export class ZipAdapter extends TokenizationAdapterBase {
  readonly id = 'zip';
  readonly displayName = 'Zip';
  readonly pattern = 'server-bnpl' as const;

  static readonly capabilities: AdapterCapabilities = {
    pattern: 'tokenization',
    displayName: 'Zip',
    region: 'Global',
    callbacks: defaultCallbacks('tokenization'),
    sdk: {
      requiresClientScript: true,
      cdnUrl: ZIP_SDK_URL,
      globalVariable: ZIP_GLOBAL,
      providerSdkVersion: 'v1',
    },
    ui: { providesButton: true, providesIcon: true, providesBrandedColors: true, requiresMerchantCapabilityCheck: false, requiresDomainVerification: false },
    handoff: { requiresMerchantValidation: false, requiresWebhook: false },
    bnpl: { providesPromoWidget: true, providesPriceTagMessaging: true, paymentTimeoutBudgetMs: 15 * 60 * 1000, authHoldTTLMs: 24 * 60 * 60 * 1000 },
    interactive: defaultInteractive(),
    intents: { supportsGatewayInitiated: true, supportsMerchantInitiated: false, supportsSeparateCapture: false, supportsVoid: true, supportsRefund: true, supportsPartialCapture: false, supportsPartialRefund: true },
  };

  override async loadSDK(): Promise<void> {
    try { await loadScript(ZIP_SDK_URL); }
    catch (err) { throw new ScriptLoadError('zip', ZIP_SDK_URL, err); }
    if (!window.Zip?.Checkout) {
      throw new ScriptLoadError('zip', ZIP_SDK_URL, 'Zip.Checkout not exposed');
    }
  }

  protected override async tokenize(): Promise<TokenizationToken> {
    if (!window.Zip) throw new Error('Zip SDK not loaded');
    const res = await fetch(`/v2/orders/${this.id}/preflight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: this.config.amount, merchantOrderId: this.config.merchantOrderId }),
    });
    if (!res.ok) throw new Error(`Zip preflight failed: ${res.status}`);
    const { checkoutId } = (await res.json()) as { checkoutId: string };

    return new Promise<TokenizationToken>((resolve, reject) => {
      window.Zip!.Checkout.open({
        checkoutId,
        onComplete: (result) => {
          if (result.result === 'approved') {
            resolve({
              kind: 'tokenization',
              provider: 'zip',
              payload: { checkoutId: result.checkoutId, sessionId: result.sessionId },
            });
          } else {
            reject(new Error(`Zip ${result.result}: ${result.error ?? 'user did not approve'}`));
          }
        },
      });
    });
  }
}
