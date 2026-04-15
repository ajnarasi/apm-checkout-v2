/**
 * Apple Pay — REAL hero adapter (v2.1).
 *
 * Pattern: native-wallet (extends NativeWalletAdapterBase)
 * Region:  Global (iOS Safari + macOS Safari)
 * Spec:    https://developer.apple.com/documentation/apple_pay_on_the_web
 *
 * Real-SDK pattern. This file is the production-shaped reference for engineers
 * integrating Apple Pay via Commerce Hub. The Apple Pay device API
 * (`window.ApplePaySession`) is built into Safari — there is no script to load.
 *
 * Critical Apple-Pay-specific semantics:
 *
 * 1. **Merchant validation handoff** — When the user clicks the Apple Pay
 *    button, Safari fires `onvalidatemerchant` with a validation URL pointing
 *    at Apple's CDN. The merchant backend MUST sign a request to that URL
 *    using its Apple Pay merchant certificate and return the signature.
 *    This adapter forwards the validation URL to the reference server's
 *    `POST /v2/applepay/merchant-validation` route.
 *
 * 2. **Single-use payment token** — After the user authorizes with Touch ID /
 *    Face ID, Safari fires `onpaymentauthorized` with `event.payment.token.paymentData`.
 *    This is encrypted and SINGLE-USE — if forwarding to CH fails, you cannot
 *    retry the same token. NativeWalletAdapterBase throws `SingleUseTokenConsumedError`
 *    in that case so the merchant frontend can re-prompt the user.
 *
 * 3. **canMakePayments preflight** — Required by Apple Pay. The base class
 *    asserts `ApplePaySession.canMakePayments()` returns true during init.
 *
 * 4. **Domain verification** — Apple Pay requires the merchant domain to be
 *    pre-verified with Apple via a `.well-known/apple-developer-merchantid-domain-association`
 *    file. The reference server's deploy docs cover this.
 *
 * 5. **Pre-auth address redaction** — Apple Pay's `shippingContact` in the
 *    validation phase only contains city / region / postalCode / country —
 *    no street address, no recipient name. The full address only arrives in
 *    `onpaymentauthorized.payment.shippingContact`. The InteractiveCallbackBus
 *    is shaped to respect this privacy boundary.
 */

import type { AdapterCapabilities } from '@commercehub/shared-types';
import {
  defaultCallbacks,
  defaultInteractive,
} from '@commercehub/shared-types';

import { NativeWalletAdapterBase } from '../base/native-wallet-base.js';
import type { NativeWalletToken } from '../base/provider-token.js';
import type { AdapterContext, CheckoutConfig } from '../../core/types.js';

// ──────────────────── ApplePaySession type definitions ────────────────────
// Minimal subset of WebKit's ApplePaySession. In production publish as
// @types/applepayjs (Apple's own typings) instead of inlining these.

interface ApplePayPaymentRequest {
  countryCode: string;
  currencyCode: string;
  merchantCapabilities: string[];
  supportedNetworks: string[];
  total: { label: string; amount: string; type?: 'final' | 'pending' };
  requiredShippingContactFields?: string[];
  requiredBillingContactFields?: string[];
}

interface ApplePayPaymentToken {
  paymentData: unknown;
  paymentMethod: { network?: string; type?: string; displayName?: string };
  transactionIdentifier: string;
}

interface ApplePayPayment {
  token: ApplePayPaymentToken;
  shippingContact?: ApplePayShippingContact;
  billingContact?: unknown;
}

interface ApplePayShippingContact {
  locality?: string;
  administrativeArea?: string;
  postalCode?: string;
  countryCode?: string;
}

interface ApplePayValidateMerchantEvent {
  validationURL: string;
}

interface ApplePayPaymentAuthorizedEvent {
  payment: ApplePayPayment;
}

interface ApplePaySessionInstance {
  begin(): void;
  abort(): void;
  completeMerchantValidation(merchantSession: unknown): void;
  completePayment(status: number): void;
  onvalidatemerchant: (event: ApplePayValidateMerchantEvent) => void;
  onpaymentauthorized: (event: ApplePayPaymentAuthorizedEvent) => void;
  oncancel: () => void;
}

interface ApplePaySessionConstructor {
  new (version: number, request: ApplePayPaymentRequest): ApplePaySessionInstance;
  canMakePayments(): boolean;
  STATUS_SUCCESS: number;
  STATUS_FAILURE: number;
}

declare global {
  interface Window {
    ApplePaySession?: ApplePaySessionConstructor;
  }
}

// ──────────────────── Adapter ────────────────────

export class ApplePayAdapter extends NativeWalletAdapterBase {
  readonly id = 'applepay';
  readonly displayName = 'Apple Pay';
  readonly pattern = 'native-wallet' as const;

  private sessionInstance?: ApplePaySessionInstance;

  static readonly capabilities: AdapterCapabilities = {
    pattern: 'native-wallet',
    displayName: 'Apple Pay',
    region: 'Global',
    callbacks: defaultCallbacks('native-wallet'),
    sdk: {
      requiresClientScript: false, // ApplePaySession is built into Safari
      providerSdkVersion: 'v3', // Apple Pay version 3
    },
    ui: {
      providesButton: true, // <apple-pay-button> web component or CSS button
      providesIcon: true,
      providesBrandedColors: true,
      requiresMerchantCapabilityCheck: true,
      requiresDomainVerification: true,
    },
    handoff: {
      requiresMerchantValidation: true, // onvalidatemerchant round-trip
      requiresWebhook: false, // sync-only — no webhook needed
    },
    bnpl: {
      providesPromoWidget: false,
      providesPriceTagMessaging: false,
      paymentTimeoutBudgetMs: 30 * 1000, // ~30 sec wallet sheet timeout
    },
    interactive: {
      ...defaultInteractive(),
      onShippingAddressChange: true,
      onShippingMethodChange: true,
      onCouponChange: true, // iOS 15+
      onPaymentMethodChange: true,
      callbackDeadlineMs: 30000, // Apple Pay's hard 30s budget
    },
    intents: {
      supportsGatewayInitiated: true,
      supportsMerchantInitiated: false, // Apple Pay is sale-only
      supportsSeparateCapture: false,
      supportsVoid: false,
      supportsRefund: true,
      supportsPartialCapture: false,
      defaultInitiator: 'GATEWAY',
    },
    token: {
      singleUse: true, // CRITICAL: Apple Pay payment tokens are single-use
      tokenTTLMs: 60 * 1000, // ~60 sec — token expires fast
    },
    eligibility: {
      supportedCurrencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CNY'],
      supportedCountries: [], // Available in 70+ countries
      supportedLocales: ['en-US', 'en-GB', 'fr-FR', 'de-DE', 'ja-JP', 'zh-CN'],
    },
    csp: {
      scriptOrigins: [], // No CDN
      frameOrigins: [],
      connectOrigins: ['https://apple-pay-gateway.apple.com'],
    },
    amountTransform: 'NUMBER_TO_STRING', // Apple Pay expects amounts as decimal strings
  };

  // ──────────────────── lifecycle ────────────────────

  /** Apple Pay needs no script to load — ApplePaySession is built into Safari. */
  override async loadSDK(): Promise<void> {
    // No-op.
  }

  /** Init = preflight `canMakePayments()`. */
  protected override async doInit(
    _config: CheckoutConfig,
    _ctx: AdapterContext
  ): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('Apple Pay requires a browser environment');
    }
    if (!window.ApplePaySession) {
      throw new Error(
        'ApplePaySession is not available — Apple Pay requires Safari on iOS 11.3+ or macOS 10.13.4+'
      );
    }
    if (!window.ApplePaySession.canMakePayments()) {
      throw new Error(
        'ApplePaySession.canMakePayments() returned false — device has no Apple Pay capability'
      );
    }
  }

  /**
   * Tokenize = construct ApplePaySession + drive the wallet sheet to completion.
   * Returns the encrypted payment token from `onpaymentauthorized`.
   */
  protected override async tokenize(): Promise<NativeWalletToken> {
    if (typeof window === 'undefined' || !window.ApplePaySession) {
      throw new Error('ApplePaySession not available');
    }

    const ApplePaySession = window.ApplePaySession;

    // STEP 1 — Build the payment request per Apple Pay spec.
    const paymentRequest: ApplePayPaymentRequest = {
      countryCode: this.deriveCountryCode(),
      currencyCode: this.config.amount.currency,
      merchantCapabilities: ['supports3DS'],
      supportedNetworks: ['visa', 'masterCard', 'amex', 'discover'],
      total: {
        label: this.config.adapterOptions
          ? (this.config.adapterOptions as { merchantName?: string }).merchantName ??
            'Total'
          : 'Total',
        amount: this.config.amount.value.toFixed(2), // Apple Pay wants decimal string
        type: 'final',
      },
    };

    return new Promise<NativeWalletToken>((resolve, reject) => {
      const session = new ApplePaySession(3, paymentRequest);
      this.sessionInstance = session;

      // STEP 2 — Merchant validation handoff. Apple's CDN gives us a one-time
      // validation URL. Forward to the merchant backend which signs with the
      // merchant's Apple Pay certificate and returns the signed merchant session.
      session.onvalidatemerchant = async (event: ApplePayValidateMerchantEvent) => {
        try {
          const merchantSession = await this.validateMerchant(event.validationURL);
          session.completeMerchantValidation(merchantSession);
        } catch (err) {
          session.abort();
          reject(
            new Error(
              `Apple Pay merchant validation failed: ${
                err instanceof Error ? err.message : String(err)
              }`
            )
          );
        }
      };

      // STEP 3 — User authorized with Face ID / Touch ID. Token is now in hand.
      // CRITICAL: this token is SINGLE-USE. Resolve the promise so the base
      // class can forward to CH. If forwarding fails, the base class throws
      // SingleUseTokenConsumedError which signals the merchant frontend to
      // restart the wallet sheet.
      session.onpaymentauthorized = (event: ApplePayPaymentAuthorizedEvent) => {
        const token: NativeWalletToken = {
          kind: 'native-wallet',
          provider: 'applepay',
          payload: {
            paymentData: JSON.stringify(event.payment.token.paymentData),
            network: event.payment.token.paymentMethod.network,
          },
        };
        // Tell Apple we accepted the token. The actual CH call happens
        // asynchronously after this resolves — Apple Pay considers the sheet
        // complete at this point.
        session.completePayment(ApplePaySession.STATUS_SUCCESS);
        resolve(token);
      };

      session.oncancel = () => {
        reject(new Error('User cancelled Apple Pay sheet'));
      };

      // STEP 4 — Begin the session. This pops the Apple Pay sheet on the user's device.
      session.begin();
    });
  }

  protected override async doTeardown(): Promise<void> {
    try {
      this.sessionInstance?.abort();
    } catch {
      // Session may already be in a terminal state — abort is best-effort.
    }
    this.sessionInstance = undefined;
  }

  // ──────────────────── helpers ────────────────────

  /**
   * Forward Apple's validation URL to the reference server's merchant validation
   * route. The server signs with the merchant's Apple Pay certificate and returns
   * the signed merchant session.
   */
  private async validateMerchant(validationURL: string): Promise<unknown> {
    const url = `${this.config.credentials.chBaseUrl.replace(/\/$/, '')}/v2/applepay/merchant-validation`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.credentials.accessToken}`,
      },
      body: JSON.stringify({
        validationURL,
        domainName: typeof window !== 'undefined' ? window.location.hostname : '',
        displayName: (this.config.adapterOptions as { merchantName?: string } | undefined)
          ?.merchantName,
      }),
    });
    if (!response.ok) {
      throw new Error(`Merchant validation HTTP ${response.status}`);
    }
    return response.json();
  }

  /** Derive the Apple Pay country code from the merchant configuration. */
  private deriveCountryCode(): string {
    const opts = this.config.adapterOptions as { countryCode?: string } | undefined;
    if (opts?.countryCode) return opts.countryCode;
    // Default to US — production code should pick from billing address or merchant config.
    return 'US';
  }
}
