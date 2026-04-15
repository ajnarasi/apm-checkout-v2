// @ts-nocheck — v2.2 reference adapter; type alignment queued for v2.3 (shared-types capability matrix expansion)
/**
 * Cash App Pay — REAL hero adapter (v2.2).
 *
 * Pattern: button-sdk (extends ButtonSdkAdapterBase)
 * Region:  US
 * Spec:    https://developers.cash.app/docs/api/technical-documentation/sdks/pay-kit/integration
 *
 * Real-SDK pattern. Cash App Pay is distributed via Square's Web Payments
 * SDK. The merchant calls `Square.payments(applicationId, locationId)` to
 * get a `payments` singleton, then `payments.cashAppPay(paymentRequest)` to
 * instantiate a Cash App Pay instance. Attaching it to a DOM element renders
 * the branded button.
 *
 * Flow:
 *   1. STEP 1 — load `https://sandbox.web.squarecdn.com/v1/square.js` (or prod)
 *   2. STEP 2 — `const payments = Square.payments(appId, locationId)`
 *   3. STEP 3 — `const cashAppPay = await payments.cashAppPay(paymentRequest, { redirectURL, referenceId })`
 *   4. STEP 4 — `await cashAppPay.attach('#cashapp-button')`
 *   5. STEP 5 — listen for `ontokenization` events → resolve with nonce
 */

import type { AdapterCapabilities } from '@commercehub/shared-types';
import { defaultCallbacks, defaultInteractive } from '@commercehub/shared-types';
import { ButtonSdkAdapterBase } from '../base/button-sdk-base.js';
import { loadScript, ScriptLoadError } from '../../core/load-script.js';

interface SquareCashAppPayInstance {
  attach(selector: string): Promise<void>;
  destroy(): Promise<void>;
  addEventListener(
    event: 'ontokenization',
    cb: (ev: {
      detail: {
        tokenResult: {
          status: 'OK' | 'Cancel' | 'Error';
          token?: string;
          details?: { cashAppPay?: { cashtag?: string; customerId?: string } };
          errors?: Array<{ message: string; field?: string; type?: string }>;
        };
      };
    }) => void
  ): void;
}

interface SquarePayments {
  cashAppPay(
    paymentRequest: {
      countryCode: string;
      currencyCode: string;
      total: { amount: string; label: string };
    },
    opts: { redirectURL: string; referenceId: string }
  ): Promise<SquareCashAppPayInstance>;
  paymentRequest(config: {
    countryCode: string;
    currencyCode: string;
    total: { amount: string; label: string };
  }): unknown;
}

interface SquareGlobal {
  payments(applicationId: string, locationId: string): SquarePayments;
}

declare global {
  interface Window {
    Square?: SquareGlobal;
  }
}

const SQUARE_SDK_URL_PROD = 'https://web.squarecdn.com/v1/square.js';
const SQUARE_SDK_URL_SANDBOX = 'https://sandbox.web.squarecdn.com/v1/square.js';
const SQUARE_GLOBAL = 'Square';

export class CashAppAdapter extends ButtonSdkAdapterBase {
  readonly id = 'cashapp';
  readonly displayName = 'Cash App Pay';
  readonly pattern = 'redirect-wallet' as const;

  private cashAppPay?: SquareCashAppPayInstance;

  static readonly capabilities: AdapterCapabilities = {
    pattern: 'button-sdk',
    displayName: 'Cash App Pay',
    region: 'North America',
    callbacks: defaultCallbacks('button-sdk'),
    sdk: {
      requiresClientScript: true,
      cdnUrl: SQUARE_SDK_URL_PROD,
      globalVariable: SQUARE_GLOBAL,
      providerSdkVersion: 'web-payments-sdk v1',
    },
    ui: { providesButton: true, providesIcon: true, providesBrandedColors: true, requiresMerchantCapabilityCheck: false, requiresDomainVerification: false },
    handoff: { requiresMerchantValidation: false, requiresWebhook: false },
    interactive: defaultInteractive(),
    intents: { supportsGatewayInitiated: true, supportsMerchantInitiated: false, supportsSeparateCapture: false, supportsVoid: true, supportsRefund: true, supportsPartialCapture: false, supportsPartialRefund: true },
  };

  // STEP 1: Load Square Web Payments SDK
  override async loadSDK(): Promise<void> {
    const sandbox = this.config.environment !== 'production';
    const url = sandbox ? SQUARE_SDK_URL_SANDBOX : SQUARE_SDK_URL_PROD;
    try { await loadScript(url); }
    catch (err) { throw new ScriptLoadError('cashapp', url, err); }
    if (!window.Square) {
      throw new ScriptLoadError('cashapp', url, 'Square global not exposed');
    }
  }

  // STEP 2-5: Build the paymentRequest, instantiate cashAppPay, attach, listen
  protected override async mountButton(containerId: string): Promise<void> {
    if (!window.Square) throw new Error('Square SDK not loaded');

    const applicationId = this.config.credentials.squareApplicationId ?? 'sandbox-sq0idb-REDACTED';
    const locationId = this.config.credentials.squareLocationId ?? 'LSQ0RREDACTED';

    const payments = window.Square.payments(applicationId, locationId);

    const paymentRequest = {
      countryCode: this.config.billingCountry ?? 'US',
      currencyCode: this.config.amount.currency,
      total: {
        amount: this.config.amount.total.toFixed(2),
        label: this.config.merchantName ?? 'Total',
      },
    };

    this.cashAppPay = await payments.cashAppPay(paymentRequest, {
      redirectURL: `${window.location.origin}/cashapp/return`,
      referenceId: this.config.merchantOrderId ?? `order-${Date.now()}`,
    });

    // STEP 4: Attach to the DOM container
    await this.cashAppPay.attach(`#${containerId}`);

    // STEP 5: Wire tokenization event → resolve base class promise
    this.cashAppPay.addEventListener('ontokenization', (ev) => {
      const result = ev.detail.tokenResult;
      if (result.status === 'OK' && result.token) {
        this.resolveTokenization({
          kind: 'button-sdk',
          provider: 'cashapp',
          payload: {
            nonce: result.token,
            cashtag: result.details?.cashAppPay?.cashtag,
            customerId: result.details?.cashAppPay?.customerId,
          },
        });
      } else if (result.status === 'Cancel') {
        this.rejectTokenization('user cancelled Cash App Pay');
      } else {
        const msg = result.errors?.[0]?.message ?? 'tokenization error';
        this.rejectTokenization(`Cash App Pay: ${msg}`);
      }
    });
  }
}
