// @ts-nocheck — v2.2 reference adapter; type alignment queued for v2.3 (shared-types capability matrix expansion)
/**
 * Google Pay — REAL hero adapter (v2.2).
 *
 * Pattern: native-wallet (extends NativeWalletAdapterBase)
 * Region:  Global (Chrome + Android)
 * Spec:    https://developers.google.com/pay/api/web/reference/request-objects
 *
 * Real-SDK pattern. Production-shaped reference code for engineers integrating
 * Google Pay via Commerce Hub. Unlike Apple Pay, Google Pay requires loading a
 * JS SDK from Google's CDN (`https://pay.google.com/gp/p/js/pay.js`) which
 * exposes `window.google.payments.api.PaymentsClient`.
 *
 * Flow:
 *   1. STEP 1 — load `https://pay.google.com/gp/p/js/pay.js`
 *   2. STEP 2 — instantiate `new google.payments.api.PaymentsClient({environment: 'TEST'|'PRODUCTION'})`
 *   3. STEP 3 — call `paymentsClient.isReadyToPay(baseRequest)` as a preflight
 *   4. STEP 4 — on user click, call `paymentsClient.loadPaymentData(paymentRequest)`
 *               which opens the Google Pay sheet. The user authenticates and
 *               the promise resolves with `paymentData.paymentMethodData.tokenizationData.token`
 *   5. STEP 5 — forward the encrypted token to merchant backend via
 *               sessionClient.authorizeOrder → CH /checkouts/v1/orders
 *
 * Single-use token semantics: identical to Apple Pay. NativeWalletAdapterBase
 * transitions back to `ready` on forwarding failure so the merchant frontend
 * can re-prompt.
 *
 * Tokenization spec:
 *   - `type: 'PAYMENT_GATEWAY'` — CH is the gateway, so tokenization params
 *     declare `gateway: 'commercehub'`, `gatewayMerchantId: <merchant id>`.
 *   - CH returns an encrypted Google Pay token that can be decrypted only by
 *     the issuing network via CH's secure channel. Never log the token value.
 */

import type { AdapterCapabilities, OrderResult } from '@commercehub/shared-types';
import {
  defaultCallbacks,
  defaultInteractive,
} from '@commercehub/shared-types';

import { NativeWalletAdapterBase } from '../base/native-wallet-base.js';
import type { NativeWalletToken } from '../base/provider-token.js';
import type { AdapterContext, CheckoutConfig } from '../../core/types.js';
import { loadScript, ScriptLoadError } from '../../core/load-script.js';

// ──────────────────── Google Pay type definitions ────────────────────
// Minimal subset of `google.payments.api`. In production publish via
// @google-pay/button-element or @types/google.payments.

interface GooglePayTokenizationSpecification {
  type: 'PAYMENT_GATEWAY' | 'DIRECT';
  parameters: {
    gateway?: string;
    gatewayMerchantId?: string;
    protocolVersion?: string;
    publicKey?: string;
  };
}

interface GooglePayCardParameters {
  allowedAuthMethods: Array<'PAN_ONLY' | 'CRYPTOGRAM_3DS'>;
  allowedCardNetworks: Array<'AMEX' | 'DISCOVER' | 'INTERAC' | 'JCB' | 'MASTERCARD' | 'VISA'>;
  billingAddressRequired?: boolean;
  billingAddressParameters?: { format?: 'MIN' | 'FULL'; phoneNumberRequired?: boolean };
}

interface GooglePayAllowedPaymentMethod {
  type: 'CARD';
  parameters: GooglePayCardParameters;
  tokenizationSpecification: GooglePayTokenizationSpecification;
}

interface GooglePayTransactionInfo {
  countryCode: string;
  currencyCode: string;
  totalPriceStatus: 'FINAL' | 'ESTIMATED';
  totalPrice: string;
  displayItems?: Array<{ label: string; type: 'LINE_ITEM' | 'SUBTOTAL'; price: string }>;
}

interface GooglePayPaymentDataRequest {
  apiVersion: 2;
  apiVersionMinor: 0;
  allowedPaymentMethods: GooglePayAllowedPaymentMethod[];
  merchantInfo: { merchantId?: string; merchantName?: string };
  transactionInfo: GooglePayTransactionInfo;
  shippingAddressRequired?: boolean;
  shippingAddressParameters?: { phoneNumberRequired?: boolean; allowedCountryCodes?: string[] };
  emailRequired?: boolean;
  callbackIntents?: Array<'SHIPPING_ADDRESS' | 'SHIPPING_OPTION' | 'PAYMENT_AUTHORIZATION'>;
}

interface GooglePayPaymentData {
  apiVersion: 2;
  paymentMethodData: {
    type: 'CARD';
    description: string;
    info: { cardNetwork: string; cardDetails: string };
    tokenizationData: { type: 'PAYMENT_GATEWAY'; token: string };
  };
  shippingAddress?: {
    name?: string;
    postalCode?: string;
    countryCode?: string;
    administrativeArea?: string;
    locality?: string;
    address1?: string;
  };
  email?: string;
}

interface GooglePayPaymentsClient {
  isReadyToPay(request: {
    apiVersion: 2;
    apiVersionMinor: 0;
    allowedPaymentMethods: GooglePayAllowedPaymentMethod[];
  }): Promise<{ result: boolean }>;
  loadPaymentData(request: GooglePayPaymentDataRequest): Promise<GooglePayPaymentData>;
  createButton(opts: {
    onClick: () => void;
    buttonColor?: 'default' | 'black' | 'white';
    buttonType?: 'book' | 'buy' | 'checkout' | 'donate' | 'order' | 'pay' | 'plain' | 'subscribe';
    buttonRadius?: number;
  }): HTMLElement;
  prefetchPaymentData(request: GooglePayPaymentDataRequest): void;
}

interface GooglePayApi {
  PaymentsClient: new (config: {
    environment: 'TEST' | 'PRODUCTION';
    merchantInfo?: { merchantId?: string; merchantName?: string };
    paymentDataCallbacks?: {
      onPaymentDataChanged?: (data: GooglePayPaymentData) => Promise<unknown>;
      onPaymentAuthorized?: (data: GooglePayPaymentData) => Promise<{ transactionState: 'SUCCESS' | 'ERROR' }>;
    };
  }) => GooglePayPaymentsClient;
}

declare global {
  interface Window {
    google?: { payments?: { api?: GooglePayApi } };
  }
}

const GOOGLEPAY_SDK_URL = 'https://pay.google.com/gp/p/js/pay.js';
const GOOGLEPAY_GLOBAL = 'google';

// ──────────────────── Adapter ────────────────────

export class GooglePayAdapter extends NativeWalletAdapterBase {
  readonly id = 'googlepay';
  readonly displayName = 'Google Pay';
  readonly pattern = 'native-wallet' as const;

  private paymentsClient?: GooglePayPaymentsClient;

  /** AdapterCapabilities declared co-located. */
  static readonly capabilities: AdapterCapabilities = {
    pattern: 'native-wallet',
    displayName: 'Google Pay',
    region: 'Global',
    callbacks: defaultCallbacks('native-wallet'),
    sdk: {
      requiresClientScript: true,
      cdnUrl: GOOGLEPAY_SDK_URL,
      globalVariable: GOOGLEPAY_GLOBAL,
      providerSdkVersion: 'pay.js/v2',
    },
    ui: {
      providesButton: true,
      providesIcon: true,
      providesBrandedColors: true,
      requiresMerchantCapabilityCheck: true,
      requiresDomainVerification: false,
    },
    handoff: {
      requiresMerchantValidation: false,
      requiresWebhook: false,
    },
    token: {
      tokenSingleUse: true,
      tokenTTLMs: 60 * 1000, // ~60s, Google Pay tokens are short-lived
    },
    interactive: {
      ...defaultInteractive(),
      onShippingAddressChange: true,
      onShippingMethodChange: true,
    },
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

  // STEP 1: Load Google's pay.js
  override async loadSDK(): Promise<void> {
    try {
      await loadScript(GOOGLEPAY_SDK_URL);
    } catch (err) {
      throw new ScriptLoadError('googlepay', GOOGLEPAY_SDK_URL, err);
    }
    if (!window.google?.payments?.api?.PaymentsClient) {
      throw new ScriptLoadError('googlepay', GOOGLEPAY_SDK_URL, 'google.payments.api.PaymentsClient not exposed after load');
    }
  }

  // STEP 2-3: Instantiate PaymentsClient and preflight isReadyToPay
  protected override async doInit(_config: CheckoutConfig, _ctx: AdapterContext): Promise<void> {
    if (!window.google?.payments?.api?.PaymentsClient) {
      throw new Error('Google Pay API not loaded — did loadSDK() succeed?');
    }
    this.paymentsClient = new window.google.payments.api.PaymentsClient({
      environment: this.isSandbox() ? 'TEST' : 'PRODUCTION',
      merchantInfo: {
        merchantName: this.config.merchantName ?? 'Fiserv Merchant',
      },
    });
    const ready = await this.paymentsClient.isReadyToPay({
      apiVersion: 2,
      apiVersionMinor: 0,
      allowedPaymentMethods: [this.buildAllowedPaymentMethod()],
    });
    if (!ready.result) {
      throw new Error('Google Pay is not ready to pay on this device / browser');
    }
  }

  // STEP 4: Open the Google Pay sheet and await the encrypted token
  protected override async tokenize(): Promise<NativeWalletToken> {
    if (!this.paymentsClient) {
      throw new Error('doInit() must complete before tokenize()');
    }
    const request: GooglePayPaymentDataRequest = {
      apiVersion: 2,
      apiVersionMinor: 0,
      allowedPaymentMethods: [this.buildAllowedPaymentMethod()],
      merchantInfo: {
        merchantName: this.config.merchantName ?? 'Fiserv Merchant',
      },
      transactionInfo: {
        countryCode: this.config.billingCountry ?? 'US',
        currencyCode: this.config.amount.currency,
        totalPriceStatus: 'FINAL',
        totalPrice: this.config.amount.total.toFixed(2),
      },
      emailRequired: false,
      shippingAddressRequired: false,
    };

    const paymentData = await this.paymentsClient.loadPaymentData(request);
    return {
      kind: 'native-wallet',
      provider: 'googlepay',
      payload: {
        tokenizationData: paymentData.paymentMethodData.tokenizationData.token,
        network: paymentData.paymentMethodData.info.cardNetwork,
        last4: paymentData.paymentMethodData.info.cardDetails,
      },
    };
  }

  private buildAllowedPaymentMethod(): GooglePayAllowedPaymentMethod {
    return {
      type: 'CARD',
      parameters: {
        allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
        allowedCardNetworks: ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER'],
      },
      tokenizationSpecification: {
        type: 'PAYMENT_GATEWAY',
        parameters: {
          gateway: 'commercehub',
          gatewayMerchantId: this.config.merchantId ?? 'test-merchant',
        },
      },
    };
  }

  private isSandbox(): boolean {
    return this.config.environment !== 'production';
  }
}
