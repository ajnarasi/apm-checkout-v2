/**
 * AdapterCapabilities — typed 55+ row × ~25 column capability matrix.
 *
 * Lifted forward from v1's prior-art capability matrix (the architect-mandated
 * gate from review #2: PRIOR_ART.md carry-forward for columnar artifacts).
 *
 * Every adapter MUST declare its full AdapterCapabilities row co-located in
 * its adapter file. A CI test (test/adapter-capability-coverage.test.ts) fails
 * the build if any registered adapter is missing fields. This is the
 * column-sweep enforcement from the post-mortem checklist.
 *
 * The five columnar sections from v1 are preserved as nested objects.
 * New v2.1 sections (interactive callbacks, intents/initiator, amount transform,
 * token TTL, currencies, partial capture, SDK version, script origins) are
 * additive.
 */

/**
 * Pattern enum — mirrors the 6 base classes in v2.1 Phase E.2.
 * Adapters extend exactly one base class matching this pattern.
 */
export type APMPattern =
  | 'redirect' // HPP redirect (iDEAL, SOFORT, Bancontact, Trustly, BLIK, ...)
  | 'tokenization' // BNPL JS SDK returning a token (Klarna, Affirm, Afterpay, Sezzle, Zip)
  | 'native-wallet' // Device API (Apple Pay, Google Pay)
  | 'button-sdk' // Provider-rendered button + onApprove (PayPal, Venmo, CashApp, Amazon Pay)
  | 'qr' // QR code + polling/webhook (PIX, Alipay, WeChat Pay, UPI, PayNow, PromptPay, TWINT)
  | 'voucher'; // Offline barcode/voucher (Boleto, OXXO, Konbini, Baloto, PagoFácil, Multibanco)

/**
 * Amount transform — must match the v1 endpoint table column.
 * Applied at SessionClient layer (centralized) so adapters can't forget.
 */
export type AmountTransform =
  | 'MULTIPLY_100' // 49.99 → 4999 (integer minor units)
  | 'NUMBER_TO_STRING' // 49.99 → "49.99"
  | 'DECIMAL_TO_STRING_CENTS' // 49.99 → "4999"
  | 'PASSTHROUGH'; // 49.99 → 49.99 (no transform)

/**
 * Section 1 — Universal Callback Contract (from v1 matrix columns 1-8).
 * These map to canonical CheckoutEvents. All defaults to `true` for
 * adapters that go through BaseAdapter (the state machine emits them
 * automatically from transitions).
 */
export interface CallbackContract {
  onInit: boolean;
  onReady: boolean;
  onError: boolean;
  onCancel: boolean;
  onRedirect: boolean; // true for redirect/tokenization/button-sdk patterns
  onQRScan: boolean; // true for qr pattern
  onVoucherDisplay: boolean; // true for voucher pattern
  onVoucherPolling: boolean; // true for voucher + qr patterns
}

/**
 * Section 2 — SDK Metadata (from v1 matrix column 9).
 * Whether the APM ships a browser-side SDK script that needs CDN injection.
 */
export interface SdkMetadata {
  /** Whether a browser-side provider SDK script must be loaded. */
  requiresClientScript: boolean;
  /** CDN URL of the provider SDK script. Required when requiresClientScript=true. */
  cdnUrl?: string;
  /** Optional Subresource Integrity hash. Recommended for production. */
  integrity?: string;
  /** Global JavaScript variable the SDK exposes (e.g. "Klarna", "paypal"). */
  globalVariable?: string;
  /** Specific provider SDK version this adapter is tested against. */
  providerSdkVersion?: string;
}

/**
 * Section 3 — Button & Styling (from v1 matrix columns 10-14).
 */
export interface UiCapabilities {
  /** Provider renders its own branded button widget (PayPal, Apple Pay, Google Pay). */
  providesButton: boolean;
  /** Provider supplies an icon asset. */
  providesIcon: boolean;
  /** Provider exposes brand color tokens. */
  providesBrandedColors: boolean;
  /** Apple Pay only: requires `ApplePaySession.canMakePayments()` preflight. */
  requiresMerchantCapabilityCheck: boolean;
  /** Apple Pay only: requires merchant domain verification handoff. */
  requiresDomainVerification: boolean;
}

/**
 * Section 4 — Server Handoff (from v1 matrix column 15).
 * Whether the merchant backend requires an extra step beyond just session creation.
 */
export interface ServerHandoff {
  /** Apple Pay `onvalidatemerchant` round-trip. */
  requiresMerchantValidation: boolean;
  /** Async APM that delivers terminal state via webhook. */
  requiresWebhook: boolean;
}

/**
 * Section 5 — Timeout Budgets + BNPL surface (from v1 matrix columns 16-18).
 * Plus v2.1 additions for promo widgets and price-tag messaging.
 */
export interface BnplCapabilities {
  /** Klarna placements / Affirm promo / Afterpay placement / Pay Later messaging. */
  providesPromoWidget: boolean;
  /** "4 payments of $X" widget — distinct from the promo banner. */
  providesPriceTagMessaging: boolean;
  /** Maximum time the SDK waits for user action before aborting. */
  paymentTimeoutBudgetMs?: number;
  /** How long an authorize-only hold survives at the provider. */
  authHoldTTLMs?: number;
}

/**
 * Section 6 — Interactive callbacks (NEW in v2.1, post-mortem gap #3).
 * Bidirectional wallet callbacks for shipping/coupon/payment-method changes.
 */
export interface InteractiveCallbacks {
  onShippingAddressChange: boolean;
  onShippingMethodChange: boolean;
  onCouponChange: boolean;
  onPaymentMethodChange: boolean;
  /** Wallet's deadline for the merchant's recompute response. */
  callbackDeadlineMs?: number;
}

/**
 * Section 7 — Intents / Initiator (NEW in v2.1, post-mortem gap #5).
 * Maps to CH Orders endpoint capabilities.
 */
export interface IntentCapabilities {
  /** Adapter supports gateway-initiated flow (CH triggers settlement). */
  supportsGatewayInitiated: boolean;
  /** Adapter supports merchant-initiated flow (auth then explicit capture). */
  supportsMerchantInitiated: boolean;
  /** Adapter supports separate capture call (vs sale-only). */
  supportsSeparateCapture: boolean;
  /** Adapter supports void before settlement. */
  supportsVoid: boolean;
  /** Adapter supports refund after settlement. */
  supportsRefund: boolean;
  /** Adapter supports multiple partial captures against one auth. */
  supportsPartialCapture: boolean;
  /**
   * Default initiator if merchant doesn't specify.
   * Most APMs default to GATEWAY (CH handles end-to-end).
   */
  defaultInitiator: 'GATEWAY' | 'MERCHANT';
}

/**
 * Section 8 — Token TTL (NEW in v2.1, architect Pass #2 P0 #2).
 * How long the browser-side payment token is valid before forwarding to backend.
 * Single-use tokens (Apple Pay, Google Pay) have very short TTLs.
 */
export interface TokenLifecycle {
  /** Whether the provider token is single-use (cannot be retried after a CH failure). */
  singleUse: boolean;
  /** Maximum time the token is valid for forwarding to merchant backend. */
  tokenTTLMs?: number;
}

/**
 * Section 9 — Eligibility (NEW in v2.1, architect Pass #2 P2).
 * Currency / country / locale lists for merchant-side filtering before adapter load.
 */
export interface Eligibility {
  /** ISO-4217 3-char currency codes. Empty = supports all. */
  supportedCurrencies: string[];
  /** ISO-3166-1 alpha-2 country codes. Empty = supports all. */
  supportedCountries: string[];
  /** IETF BCP47 locale codes. Empty = supports all. */
  supportedLocales: string[];
}

/**
 * Section 10 — CSP origins (NEW in v2.1, architect Pass #2 P2).
 * Script origins this adapter loads from. Merchants use this to auto-generate
 * CSP `script-src` directives.
 */
export interface CSP {
  scriptOrigins: string[];
  /** Where the provider's iframes/widgets render from (CSP `frame-src`). */
  frameOrigins: string[];
  /** Where the SDK makes XHR/fetch calls to (CSP `connect-src`). */
  connectOrigins: string[];
}

/**
 * The full capability declaration. Every adapter MUST declare every section.
 * The CI test asserts no field is missing.
 */
export interface AdapterCapabilities {
  /** The pattern the adapter follows — must match the base class it extends. */
  pattern: APMPattern;

  /** Display metadata. */
  displayName: string;
  /** Marketing region tag (Global, Europe, APAC, LATAM, MENA). */
  region: string;

  /** Section 1 — Universal callback contract. */
  callbacks: CallbackContract;

  /** Section 2 — Provider SDK metadata. */
  sdk: SdkMetadata;

  /** Section 3 — Button & styling. */
  ui: UiCapabilities;

  /** Section 4 — Server handoff requirements. */
  handoff: ServerHandoff;

  /** Section 5 — Timeout budgets + BNPL. */
  bnpl: BnplCapabilities;

  /** Section 6 — Interactive callbacks (wallet patterns). */
  interactive: InteractiveCallbacks;

  /** Section 7 — Intent + initiator support. */
  intents: IntentCapabilities;

  /** Section 8 — Token lifecycle. */
  token: TokenLifecycle;

  /** Section 9 — Eligibility filtering. */
  eligibility: Eligibility;

  /** Section 10 — Content Security Policy origins. */
  csp: CSP;

  /** Amount transform — applied at SessionClient layer. */
  amountTransform: AmountTransform;
}

/**
 * Default capability factory — produces a baseline CallbackContract for the
 * common case. Adapters override fields via spread.
 *
 * Use:
 *   capabilities: {
 *     ...defaultCapabilities('redirect'),
 *     displayName: 'iDEAL',
 *     region: 'Europe',
 *     // ... per-adapter overrides
 *   }
 */
export function defaultCallbacks(pattern: APMPattern): CallbackContract {
  return {
    onInit: true,
    onReady: true,
    onError: true,
    onCancel: true,
    onRedirect: pattern === 'redirect' || pattern === 'tokenization' || pattern === 'button-sdk',
    onQRScan: pattern === 'qr',
    onVoucherDisplay: pattern === 'voucher',
    onVoucherPolling: pattern === 'voucher' || pattern === 'qr',
  };
}

/**
 * Default interactive callbacks (most APMs don't support them).
 * Override per adapter for wallets that do.
 */
export function defaultInteractive(): InteractiveCallbacks {
  return {
    onShippingAddressChange: false,
    onShippingMethodChange: false,
    onCouponChange: false,
    onPaymentMethodChange: false,
  };
}

/**
 * Default intent capabilities for most APMs (gateway-initiated, no separate capture).
 * Override per adapter for ones that support full intent matrix.
 */
export function defaultIntents(): IntentCapabilities {
  return {
    supportsGatewayInitiated: true,
    supportsMerchantInitiated: false,
    supportsSeparateCapture: false,
    supportsVoid: false,
    supportsRefund: true, // most providers support refund via CH
    supportsPartialCapture: false,
    defaultInitiator: 'GATEWAY',
  };
}
