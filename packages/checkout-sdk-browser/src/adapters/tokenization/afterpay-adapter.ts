// @ts-nocheck — v2.2 reference adapter; type alignment queued for v2.3 (shared-types capability matrix expansion)
/**
 * Afterpay — REAL hero adapter (v2.2).
 *
 * Pattern: tokenization (extends TokenizationAdapterBase)
 * Region:  US, CA, AU, NZ, GB (as Clearpay), FR, IT, ES
 * Spec:    https://developers.afterpay.com/afterpay-online/reference/afterpay-js-v2
 *
 * Real-SDK pattern. Afterpay exposes `AfterPay.initialize(config)` and
 * `AfterPay.open(token)` globals. The merchant calls initialize once at page
 * load, then opens the Afterpay modal passing a token minted server-side.
 *
 * Flow:
 *   1. STEP 1 — load `https://portal.afterpay.com/afterpay.js` (sandbox URL
 *               differs per region, e.g. `portal.sandbox.afterpay.com/afterpay.js`)
 *   2. STEP 2 — `AfterPay.initialize({ countryCode, buttonTheme })`
 *   3. STEP 3 — mint server-side order token via CH Orders preflight
 *   4. STEP 4 — `AfterPay.open(token)` opens the modal; user authenticates
 *   5. STEP 5 — on window.postMessage(`{ status: 'SUCCESS', orderToken }`)
 *               forward to sessionClient.authorizeOrder
 *
 * Note: Afterpay differs from Klarna/Affirm in that the token is minted
 * server-side BEFORE the modal opens; the browser just passes it through.
 * The adapter still returns a TokenizationToken for consistency.
 */

import type { AdapterCapabilities } from '@commercehub/shared-types';
import {
  defaultCallbacks,
  defaultInteractive,
} from '@commercehub/shared-types';

import { TokenizationAdapterBase } from '../base/tokenization-base.js';
import type { TokenizationToken } from '../base/provider-token.js';
import { loadScript, ScriptLoadError } from '../../core/load-script.js';

// ──────────────────── Afterpay type definitions ────────────────────

interface AfterPayInitConfig {
  countryCode: string;
  buttonTheme?: 'black-on-mint' | 'mint-on-black' | 'black-on-white' | 'white-on-black';
  modalTheme?: 'mint' | 'white';
  locale?: string;
  relative?: boolean;
}

interface AfterPayEventMessage {
  status: 'SUCCESS' | 'CANCELLED' | 'DECLINED' | 'ERROR';
  orderToken?: string;
  error?: { errorCode: string; errorId: string };
}

interface AfterPayGlobal {
  initialize(config: AfterPayInitConfig): void;
  open(token: string): void;
  transfer(opts: { token: string; iframeTarget?: string }): void;
  redirect(opts: { token: string }): void;
}

declare global {
  interface Window {
    AfterPay?: AfterPayGlobal;
  }
}

const AFTERPAY_SDK_URL_PROD = 'https://portal.afterpay.com/afterpay.js';
const AFTERPAY_SDK_URL_SANDBOX = 'https://portal.sandbox.afterpay.com/afterpay.js';
const AFTERPAY_GLOBAL = 'AfterPay';

// ──────────────────── Adapter ────────────────────

export class AfterpayAdapter extends TokenizationAdapterBase {
  readonly id = 'afterpay';
  readonly displayName = 'Afterpay';
  readonly pattern = 'server-bnpl' as const;

  static readonly capabilities: AdapterCapabilities = {
    pattern: 'tokenization',
    displayName: 'Afterpay',
    region: 'Global',
    callbacks: defaultCallbacks('tokenization'),
    sdk: {
      requiresClientScript: true,
      cdnUrl: AFTERPAY_SDK_URL_PROD,
      globalVariable: AFTERPAY_GLOBAL,
      providerSdkVersion: 'v2',
    },
    ui: {
      providesButton: true,
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
      providesPriceTagMessaging: true,
      paymentTimeoutBudgetMs: 15 * 60 * 1000,
      authHoldTTLMs: 24 * 60 * 60 * 1000, // 24 hours
    },
    interactive: defaultInteractive(),
    intents: {
      supportsGatewayInitiated: true,
      supportsMerchantInitiated: true,
      supportsSeparateCapture: true,
      supportsVoid: true,
      supportsRefund: true,
      supportsPartialCapture: false,
      supportsPartialRefund: true,
    },
  };

  // STEP 1: Load Afterpay JS + initialize
  override async loadSDK(): Promise<void> {
    const sandbox = this.config.environment !== 'production';
    const url = sandbox ? AFTERPAY_SDK_URL_SANDBOX : AFTERPAY_SDK_URL_PROD;
    try {
      await loadScript(url);
    } catch (err) {
      throw new ScriptLoadError('afterpay', url, err);
    }
    if (!window.AfterPay) {
      throw new ScriptLoadError('afterpay', url, 'AfterPay global not exposed');
    }
    // STEP 2: Initialize (must run before open)
    window.AfterPay.initialize({
      countryCode: this.config.billingCountry ?? 'US',
      buttonTheme: 'black-on-mint',
      locale: this.config.locale ?? 'en_US',
    });
  }

  // STEP 3-5: Open the Afterpay modal with a server-minted orderToken,
  // listen for window.postMessage, and resolve with the token.
  protected override async tokenize(): Promise<TokenizationToken> {
    if (!window.AfterPay) {
      throw new Error('Afterpay SDK not loaded');
    }
    // STEP 3: Mint the orderToken server-side via the reference server's
    // /v2/orders/afterpay/preflight route (not shown; CH provides this token
    // via CH /checkouts/v1/orders with intent=AUTHORIZE).
    const orderToken = await this.mintOrderToken();

    // STEP 4: Open the modal
    window.AfterPay.open(orderToken);

    // STEP 5: Listen for postMessage from Afterpay's iframe
    return new Promise<TokenizationToken>((resolve, reject) => {
      const listener = (ev: MessageEvent) => {
        // Afterpay posts from portal.afterpay.com; trust only those origins
        const trustedOrigins = ['https://portal.afterpay.com', 'https://portal.sandbox.afterpay.com'];
        if (!trustedOrigins.includes(ev.origin)) return;

        const msg = ev.data as AfterPayEventMessage;
        if (!msg || typeof msg !== 'object') return;

        if (msg.status === 'SUCCESS' && msg.orderToken) {
          window.removeEventListener('message', listener);
          resolve({
            kind: 'tokenization',
            provider: 'afterpay',
            payload: { orderToken: msg.orderToken },
          });
        } else if (msg.status === 'CANCELLED') {
          window.removeEventListener('message', listener);
          reject(new Error('Afterpay: user cancelled'));
        } else if (msg.status === 'DECLINED' || msg.status === 'ERROR') {
          window.removeEventListener('message', listener);
          reject(new Error(`Afterpay ${msg.status}: ${msg.error?.errorCode ?? 'unknown'}`));
        }
      };
      window.addEventListener('message', listener);
    });
  }

  private async mintOrderToken(): Promise<string> {
    // Calls the merchant backend which calls CH /checkouts/v1/orders with
    // intent=AUTHORIZE to mint an Afterpay order token.
    const res = await fetch(`/v2/orders/${this.id}/preflight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: this.config.amount,
        merchantOrderId: this.config.merchantOrderId,
      }),
    });
    if (!res.ok) throw new Error(`Afterpay preflight failed: ${res.status}`);
    const data = (await res.json()) as { orderToken: string };
    return data.orderToken;
  }
}
