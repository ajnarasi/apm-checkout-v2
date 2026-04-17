// @ts-nocheck — v2.2 reference adapter; type alignment queued for v2.3 (shared-types capability matrix expansion)
/**
 * Affirm — REAL hero adapter (v2.2).
 *
 * Pattern: tokenization (extends TokenizationAdapterBase)
 * Region:  US, CA
 * Spec:    https://docs.affirm.com/developers/reference/affirm-checkout
 *
 * Real-SDK pattern. Production-shaped reference for engineers integrating
 * Affirm BNPL via Commerce Hub. Affirm uses a JS-driven checkout lightbox;
 * the merchant calls `affirm.checkout({...}); affirm.checkout.open({...})`
 * and the user completes the flow inside Affirm's modal. On success
 * `onSuccess` fires with a `checkout_token`.
 *
 * Flow:
 *   1. STEP 1 — load `https://cdn1.affirm.com/js/v2/affirm.js` (sandbox:
 *               `cdn1-sandbox.affirm.com`). Affirm injects a bootstrap
 *               snippet that calls `_affirm_config` from window globals.
 *   2. STEP 2 — call `affirm.checkout({ merchant, items, metadata, currency, total })`
 *               to seed the checkout payload
 *   3. STEP 3 — on user click, call `affirm.checkout.open({ onSuccess, onFail })`
 *   4. STEP 4 — Affirm opens its modal; user selects a payment plan and
 *               authenticates. On approval `onSuccess({ checkout_token })` fires.
 *   5. STEP 5 — forward `checkout_token` to merchant backend via
 *               sessionClient.authorizeOrder → CH /checkouts/v1/orders
 *
 * Promotional messaging: Affirm provides inline price-tag messaging widgets
 * (`<p class="affirm-as-low-as" data-amount="5000"></p>`) which render
 * "As low as $17/mo with Affirm". Surface via AdapterCapabilities.bnpl.providesPriceTagMessaging.
 *
 * Token TTL: Affirm checkout_tokens are valid for ~60 minutes.
 */

import type { AdapterCapabilities } from '@commercehub/shared-types';
import {
  defaultCallbacks,
  defaultInteractive,
} from '@commercehub/shared-types';

import { TokenizationAdapterBase } from '../base/tokenization-base.js';
import type { BnplToken } from '../base/provider-token.js';
import { loadScript, ScriptLoadError } from '../../core/load-script.js';

// ──────────────────── Affirm type definitions ────────────────────

interface AffirmCheckoutItem {
  display_name: string;
  sku: string;
  unit_price: number; // cents
  qty: number;
  item_image_url?: string;
  item_url?: string;
}

interface AffirmCheckoutPayload {
  merchant: {
    user_confirmation_url: string;
    user_cancel_url: string;
    user_confirmation_url_action?: 'POST' | 'GET';
    name?: string;
  };
  shipping?: {
    name?: { first?: string; last?: string };
    address?: {
      line1?: string;
      city?: string;
      state?: string;
      zipcode?: string;
      country?: string;
    };
  };
  items: AffirmCheckoutItem[];
  currency: string;
  total: number; // cents
  metadata?: Record<string, unknown>;
}

interface AffirmCheckoutGlobal {
  (payload: AffirmCheckoutPayload): void;
  open(opts: {
    onSuccess: (data: { checkout_token: string; created: string }) => void;
    onFail: (reason: { reason: string }) => void;
  }): void;
}

interface AffirmGlobal {
  checkout: AffirmCheckoutGlobal;
  ui?: {
    ready(cb: () => void): void;
    error?: { on(err: string, cb: (error: unknown) => void): void };
  };
}

declare global {
  interface Window {
    affirm?: AffirmGlobal;
    _affirm_config?: {
      public_api_key: string;
      script: string;
      locale?: string;
      country_code?: string;
    };
  }
}

const AFFIRM_SDK_URL_PROD = 'https://cdn1.affirm.com/js/v2/affirm.js';
const AFFIRM_SDK_URL_SANDBOX = 'https://cdn1-sandbox.affirm.com/js/v2/affirm.js';
const AFFIRM_GLOBAL = 'affirm';

// ──────────────────── Adapter ────────────────────

export class AffirmAdapter extends TokenizationAdapterBase {
  readonly id = 'affirm';
  readonly displayName = 'Affirm';
  readonly pattern = 'server-bnpl' as const;

  static readonly capabilities: AdapterCapabilities = {
    pattern: 'bnpl',
    displayName: 'Affirm',
    region: 'North America',
    callbacks: defaultCallbacks('bnpl'),
    sdk: {
      requiresClientScript: true,
      cdnUrl: AFFIRM_SDK_URL_PROD,
      globalVariable: AFFIRM_GLOBAL,
      providerSdkVersion: 'v2',
    },
    ui: {
      providesButton: false,
      providesIcon: true,
      providesBrandedColors: true,
      requiresMerchantCapabilityCheck: false,
      requiresDomainVerification: false,
    },
    handoff: {
      requiresMerchantValidation: false,
      requiresWebhook: false,
    },
    bnpl: {
      providesPromoWidget: true,
      providesPriceTagMessaging: true, // Affirm "as low as" tag
      paymentTimeoutBudgetMs: 15 * 60 * 1000,
      authHoldTTLMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
    interactive: defaultInteractive(),
    intents: {
      supportsGatewayInitiated: true,
      supportsMerchantInitiated: true,
      supportsSeparateCapture: true,
      supportsVoid: true,
      supportsRefund: true,
      supportsPartialCapture: true,
      supportsPartialRefund: true,
    },
  };

  // STEP 1: Load Affirm JS lib + inject _affirm_config
  override async loadSDK(): Promise<void> {
    const sandbox = this.config.environment !== 'production';
    const url = sandbox ? AFFIRM_SDK_URL_SANDBOX : AFFIRM_SDK_URL_PROD;
    window._affirm_config = {
      public_api_key: this.config.credentials.providerClientToken ?? 'SANDBOX_KEY',
      script: url,
      locale: this.config.locale ?? 'en_US',
      country_code: this.config.billingCountry ?? 'USA',
    };
    try {
      await loadScript(url);
    } catch (err) {
      throw new ScriptLoadError('affirm', url, err);
    }
    if (!window.affirm?.checkout) {
      throw new ScriptLoadError('affirm', url, 'affirm.checkout not exposed after load');
    }
  }

  // STEP 2-4: Call affirm.checkout + affirm.checkout.open and await onSuccess
  protected override async tokenize(): Promise<BnplToken> {
    if (!window.affirm?.checkout) {
      throw new Error('Affirm SDK not loaded');
    }
    const totalCents = Math.round(this.config.amount.total * 100);
    const payload: AffirmCheckoutPayload = {
      merchant: {
        user_confirmation_url: `${window.location.origin}/affirm/confirm`,
        user_cancel_url: `${window.location.origin}/affirm/cancel`,
        name: this.config.merchantName ?? 'Fiserv Merchant',
      },
      items: [
        {
          display_name: this.config.merchantOrderId ?? 'Order',
          sku: this.config.merchantOrderId ?? 'order',
          unit_price: totalCents,
          qty: 1,
        },
      ],
      currency: this.config.amount.currency,
      total: totalCents,
      metadata: { merchantOrderId: this.config.merchantOrderId },
    };

    window.affirm.checkout(payload);

    return new Promise<BnplToken>((resolve, reject) => {
      window.affirm!.checkout.open({
        onSuccess: (data) => {
          resolve({
            kind: 'bnpl',
            provider: 'affirm',
            payload: {
              checkoutToken: data.checkout_token,
              createdAt: data.created,
            },
          });
        },
        onFail: (reason) => {
          reject(new Error(`Affirm checkout failed: ${reason.reason}`));
        },
      });
    });
  }
}
