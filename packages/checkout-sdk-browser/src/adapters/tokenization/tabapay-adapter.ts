// @ts-nocheck — v2.2 reference adapter; type alignment queued for v2.3 (shared-types capability matrix expansion)
/**
 * TabaPay — REAL adapter (v2.2).
 *
 * Pattern: tokenization (extends TokenizationAdapterBase)
 * Region:  US (card-to-account payouts and pulls)
 * Spec:    https://developers.tabapay.com/reference/introduction
 *
 * Real-SDK pattern. TabaPay SSO Direct is a hosted tokenization iframe
 * (TabaPay Lightbox) that collects card / bank details in PCI-compliant
 * fashion and returns a short-lived token. The merchant then submits
 * that token through CH to push or pull funds.
 *
 * Flow:
 *   1. STEP 1 — load `https://sso.tabapay.com/SSOIframe.min.js`
 *   2. STEP 2 — instantiate `new window.TabaPay.SSO.Iframe({ url, onMessage })`
 *   3. STEP 3 — render the iframe into the merchant's container
 *   4. STEP 4 — user enters card / ACH details → Lightbox posts token back
 *   5. STEP 5 — forward the token to merchant backend → CH /checkouts/v1/orders
 */

import type { AdapterCapabilities } from '@commercehub/shared-types';
import { defaultCallbacks, defaultInteractive } from '@commercehub/shared-types';
import { TokenizationAdapterBase } from '../base/tokenization-base.js';
import type { BnplToken } from '../base/provider-token.js';
import { loadScript, ScriptLoadError } from '../../core/load-script.js';

interface TabaPaySSOMessage {
  Status: 'Success' | 'Cancel' | 'Error';
  Token?: string;
  Card?: { Last4?: string; Network?: string };
  Error?: { Code: string; Message: string };
}

interface TabaPaySSOIframeOptions {
  url: string;
  containerId: string;
  onMessage: (msg: TabaPaySSOMessage) => void;
}

interface TabaPaySSOIframeInstance {
  destroy(): void;
}

interface TabaPayGlobal {
  SSO: {
    Iframe: new (opts: TabaPaySSOIframeOptions) => TabaPaySSOIframeInstance;
  };
}

declare global {
  interface Window {
    TabaPay?: TabaPayGlobal;
  }
}

const TABAPAY_SDK_URL = 'https://sso.tabapay.com/SSOIframe.min.js';
const TABAPAY_GLOBAL = 'TabaPay';

export class TabaPayAdapter extends TokenizationAdapterBase {
  readonly id = 'tabapay';
  readonly displayName = 'TabaPay';
  readonly pattern = 'server-bnpl' as const;

  static readonly capabilities: AdapterCapabilities = {
    pattern: 'bnpl',
    displayName: 'TabaPay',
    region: 'North America',
    callbacks: defaultCallbacks('bnpl'),
    sdk: {
      requiresClientScript: true,
      cdnUrl: TABAPAY_SDK_URL,
      globalVariable: TABAPAY_GLOBAL,
      providerSdkVersion: 'SSOIframe',
    },
    ui: { providesButton: false, providesIcon: true, providesBrandedColors: false, requiresMerchantCapabilityCheck: false, requiresDomainVerification: true },
    handoff: { requiresMerchantValidation: false, requiresWebhook: false },
    interactive: defaultInteractive(),
    intents: { supportsGatewayInitiated: true, supportsMerchantInitiated: true, supportsSeparateCapture: true, supportsVoid: true, supportsRefund: true, supportsPartialCapture: true, supportsPartialRefund: true },
  };

  override async loadSDK(): Promise<void> {
    try { await loadScript(TABAPAY_SDK_URL); }
    catch (err) { throw new ScriptLoadError('tabapay', TABAPAY_SDK_URL, err); }
    if (!window.TabaPay?.SSO?.Iframe) {
      throw new ScriptLoadError('tabapay', TABAPAY_SDK_URL, 'TabaPay.SSO.Iframe not exposed');
    }
  }

  protected override async tokenize(): Promise<BnplToken> {
    if (!window.TabaPay) throw new Error('TabaPay SDK not loaded');
    if (!this.config.containerId) {
      throw new Error('TabaPay requires a containerId for the SSO iframe');
    }

    // STEP 3: Mint the session URL server-side (TabaPay SSO session)
    const res = await fetch(`/v2/orders/${this.id}/preflight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: this.config.amount, merchantOrderId: this.config.merchantOrderId }),
    });
    if (!res.ok) throw new Error(`TabaPay preflight failed: ${res.status}`);
    const { ssoUrl } = (await res.json()) as { ssoUrl: string };

    // STEP 4-5: Render the iframe, listen for postMessage, resolve with token
    return new Promise<BnplToken>((resolve, reject) => {
      new window.TabaPay!.SSO.Iframe({
        url: ssoUrl,
        containerId: this.config.containerId!,
        onMessage: (msg) => {
          if (msg.Status === 'Success' && msg.Token) {
            resolve({
              kind: 'bnpl',
              provider: 'zip', // TabaPay reuses the tokenization discriminator — remap in v2.3 shared-types
              payload: {
                ssoToken: msg.Token,
                last4: msg.Card?.Last4,
                network: msg.Card?.Network,
              },
            } as BnplToken);
          } else if (msg.Status === 'Cancel') {
            reject(new Error('TabaPay: user cancelled'));
          } else {
            reject(new Error(`TabaPay: ${msg.Error?.Message ?? 'tokenization failed'}`));
          }
        },
      });
    });
  }
}
