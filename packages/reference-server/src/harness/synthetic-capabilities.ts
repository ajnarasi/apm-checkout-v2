/**
 * Synthetic capability matrix for the v2.2 harness.
 *
 * Derives a per-APM capability row from the canonical `ApmCommerceHubMapping`
 * fields (pattern, aggregator, chSourceType, currencies, countries) using a
 * rule table. This is a pragmatic substitute for reading the real
 * `AdapterCapabilities` declarations from `checkout-sdk-browser` — we can't
 * import those at runtime today because (a) most adapters don't yet declare
 * them and (b) the browser package has pre-existing baseline TS errors that
 * block `dist/` builds.
 *
 * Every field on `SyntheticCapabilities` has a deterministic derivation from
 * one or more mapping inputs. If an adapter later ships a real
 * `AdapterCapabilities` row, the harness should prefer that — this file is
 * the fallback.
 */

import type { ApmCommerceHubMapping } from '@commercehub/shared-types';

export type Pattern = ApmCommerceHubMapping['pattern'];

/** What the UI renders per APM. Mirrors the v1 capability matrix shape. */
export interface SyntheticCapabilities {
  pattern: Pattern;
  /** Bucket for the UI to group by region. */
  region: 'Europe' | 'APAC' | 'LATAM' | 'MENA' | 'North America' | 'Global';

  // ── Flow capabilities ──
  supportsGatewayInitiated: boolean;
  supportsMerchantInitiated: boolean;
  supportsSeparateCapture: boolean;
  supportsVoid: boolean;
  supportsRefund: boolean;
  supportsPartialCapture: boolean;
  supportsPartialRefund: boolean;
  defaultInitiator: 'GATEWAY' | 'MERCHANT';

  // ── Token lifecycle ──
  tokenSingleUse: boolean;
  tokenTTLMs: number | null;
  authHoldTTLMs: number | null;

  // ── Provider SDK ──
  requiresClientScript: boolean;
  cdnUrl: string | null;
  globalVariable: string | null;

  // ── UI ──
  providesButton: boolean;
  providesIcon: boolean;
  providesPromoWidget: boolean;
  providesPriceTagMessaging: boolean;
  requiresDomainVerification: boolean;
  requiresMerchantCapabilityCheck: boolean;

  // ── Interactive callbacks (bidirectional RPC) ──
  onShippingAddressChange: boolean;
  onShippingMethodChange: boolean;
  onCouponChange: boolean;
  onPaymentMethodChange: boolean;
  /**
   * Exact provider SDK callback names mapped to the canonical capability
   * flag. Populated only for APMs that truly expose callbacks. The UI
   * uses these to build the Callbacks pane with accurate labels.
   */
  providerCallbackNames?: Partial<{
    onShippingAddressChange: string;
    onShippingMethodChange: string;
    onCouponChange: string;
    onPaymentMethodChange: string;
  }>;

  // ── Async settlement ──
  requiresWebhook: boolean;
  pollingFallback: boolean;

  // ── Amount + wire ──
  amountTransform: 'MULTIPLY_100' | 'NUMBER_TO_STRING' | 'DECIMAL_TO_STRING_CENTS' | 'PASSTHROUGH';
  /** Events the adapter is expected to emit, in rough temporal order. */
  expectedEvents: string[];
  /** Canonical event the first-writer-wins completion waits on. */
  terminalFromWebhook: boolean;

  // ── Scenarios this APM is expected to exercise cleanly ──
  eligibleScenarios: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Country → region bucket (UI grouping only).
// ────────────────────────────────────────────────────────────────────────

const EU_COUNTRIES = new Set([
  'AT','BE','BG','CH','CY','CZ','DE','DK','EE','ES','FI','FR','GB','GR','HR',
  'HU','IE','IS','IT','LI','LT','LU','LV','MT','NL','NO','PL','PT','RO','SE',
  'SI','SK',
]);
const APAC_COUNTRIES = new Set([
  'AU','CN','HK','ID','IN','JP','KR','MY','NZ','PH','SG','TH','TW','VN',
]);
const LATAM_COUNTRIES = new Set([
  'AR','BO','BR','CL','CO','CR','EC','GT','HN','MX','NI','PA','PE','PY','SV','UY','VE',
]);
const MENA_COUNTRIES = new Set([
  'AE','BH','EG','IL','JO','KW','LB','MA','OM','QA','SA','TN','TR',
]);
const NA_COUNTRIES = new Set(['CA','US']);

function regionFor(countries: readonly string[]): SyntheticCapabilities['region'] {
  if (countries.length === 0) return 'Global';
  const first = countries[0];
  if (EU_COUNTRIES.has(first)) return 'Europe';
  if (APAC_COUNTRIES.has(first)) return 'APAC';
  if (LATAM_COUNTRIES.has(first)) return 'LATAM';
  if (MENA_COUNTRIES.has(first)) return 'MENA';
  if (NA_COUNTRIES.has(first)) return 'North America';
  return 'Global';
}

// ────────────────────────────────────────────────────────────────────────
// Pattern → default capability shape.
// ────────────────────────────────────────────────────────────────────────

interface PatternDefaults {
  supportsGatewayInitiated: boolean;
  supportsMerchantInitiated: boolean;
  supportsSeparateCapture: boolean;
  supportsVoid: boolean;
  supportsRefund: boolean;
  supportsPartialCapture: boolean;
  supportsPartialRefund: boolean;
  defaultInitiator: 'GATEWAY' | 'MERCHANT';
  tokenSingleUse: boolean;
  tokenTTLMs: number | null;
  authHoldTTLMs: number | null;
  requiresClientScript: boolean;
  providesButton: boolean;
  providesIcon: boolean;
  providesPromoWidget: boolean;
  providesPriceTagMessaging: boolean;
  requiresDomainVerification: boolean;
  requiresMerchantCapabilityCheck: boolean;
  onShippingAddressChange: boolean;
  onShippingMethodChange: boolean;
  onCouponChange: boolean;
  onPaymentMethodChange: boolean;
  requiresWebhook: boolean;
  pollingFallback: boolean;
  expectedEvents: string[];
  terminalFromWebhook: boolean;
}

const BASE_EVENTS_SYNC = [
  'INITIALIZING', 'SDK_LOADED', 'PAYMENT_METHOD_READY', 'PAYMENT_AUTHORIZING',
  'PAYMENT_AUTHORIZED', 'PAYMENT_COMPLETED',
];
const BASE_EVENTS_ASYNC = [
  'INITIALIZING', 'SDK_LOADED', 'PAYMENT_METHOD_READY', 'PAYMENT_AUTHORIZING',
  'REDIRECT_REQUIRED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED',
];
const BASE_EVENTS_VOUCHER = [
  'INITIALIZING', 'PAYMENT_AUTHORIZING', 'REDIRECT_REQUIRED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED',
];

const PATTERN_DEFAULTS: Record<Pattern, PatternDefaults> = {
  redirect: {
    supportsGatewayInitiated: true,
    supportsMerchantInitiated: false,
    supportsSeparateCapture: false,
    supportsVoid: true,
    supportsRefund: true,
    supportsPartialCapture: false,
    supportsPartialRefund: true,
    defaultInitiator: 'GATEWAY',
    tokenSingleUse: true,
    tokenTTLMs: null,
    authHoldTTLMs: null,
    requiresClientScript: false,
    providesButton: false,
    providesIcon: true,
    providesPromoWidget: false,
    providesPriceTagMessaging: false,
    requiresDomainVerification: false,
    requiresMerchantCapabilityCheck: false,
    onShippingAddressChange: false,
    onShippingMethodChange: false,
    onCouponChange: false,
    onPaymentMethodChange: false,
    requiresWebhook: true,
    pollingFallback: true,
    expectedEvents: BASE_EVENTS_ASYNC,
    terminalFromWebhook: true,
  },
  tokenization: {
    supportsGatewayInitiated: true,
    supportsMerchantInitiated: true,
    supportsSeparateCapture: true,
    supportsVoid: true,
    supportsRefund: true,
    supportsPartialCapture: true,
    supportsPartialRefund: true,
    defaultInitiator: 'GATEWAY',
    tokenSingleUse: true,
    tokenTTLMs: 60 * 60 * 1000,
    authHoldTTLMs: 7 * 24 * 60 * 60 * 1000,
    requiresClientScript: true,
    providesButton: false,
    providesIcon: true,
    providesPromoWidget: true,
    providesPriceTagMessaging: true,
    requiresDomainVerification: false,
    requiresMerchantCapabilityCheck: false,
    // BNPL tokenization widgets (Klarna, Affirm, Afterpay) do NOT expose
    // shipping/coupon callbacks to the merchant — the widget handles
    // state internally and the merchant can only set up-front amount.
    onShippingAddressChange: false,
    onShippingMethodChange: false,
    onCouponChange: false,
    onPaymentMethodChange: false,
    requiresWebhook: false,
    pollingFallback: false,
    expectedEvents: BASE_EVENTS_SYNC,
    terminalFromWebhook: false,
  },
  'native-wallet': {
    supportsGatewayInitiated: true,
    supportsMerchantInitiated: true,
    supportsSeparateCapture: true,
    supportsVoid: true,
    supportsRefund: true,
    supportsPartialCapture: true,
    supportsPartialRefund: true,
    defaultInitiator: 'GATEWAY',
    tokenSingleUse: true,
    tokenTTLMs: 60 * 1000,
    authHoldTTLMs: null,
    requiresClientScript: true,
    providesButton: true,
    providesIcon: true,
    providesPromoWidget: false,
    providesPriceTagMessaging: false,
    requiresDomainVerification: true,
    requiresMerchantCapabilityCheck: true,
    // Interactive callback defaults are OFF at the pattern level —
    // overrides in `OVERRIDES` below populate per-APM accurate values
    // (Apple Pay has all 4, Google Pay only has shipping).
    onShippingAddressChange: false,
    onShippingMethodChange: false,
    onCouponChange: false,
    onPaymentMethodChange: false,
    requiresWebhook: false,
    pollingFallback: false,
    expectedEvents: BASE_EVENTS_SYNC,
    terminalFromWebhook: false,
  },
  'button-sdk': {
    supportsGatewayInitiated: true,
    supportsMerchantInitiated: true,
    supportsSeparateCapture: true,
    supportsVoid: true,
    supportsRefund: true,
    supportsPartialCapture: true,
    supportsPartialRefund: true,
    defaultInitiator: 'GATEWAY',
    tokenSingleUse: true,
    tokenTTLMs: 3 * 60 * 60 * 1000,
    authHoldTTLMs: 29 * 24 * 60 * 60 * 1000,
    requiresClientScript: true,
    providesButton: true,
    providesIcon: true,
    providesPromoWidget: true,
    providesPriceTagMessaging: true,
    requiresDomainVerification: false,
    requiresMerchantCapabilityCheck: false,
    // Default to false — only PayPal's Buttons SDK actually exposes
    // onShippingAddressChange/onShippingOptionsChange. Venmo/CashApp don't.
    onShippingAddressChange: false,
    onShippingMethodChange: false,
    onCouponChange: false,
    onPaymentMethodChange: false,
    requiresWebhook: false,
    pollingFallback: false,
    expectedEvents: BASE_EVENTS_SYNC,
    terminalFromWebhook: false,
  },
  qr: {
    supportsGatewayInitiated: true,
    supportsMerchantInitiated: false,
    supportsSeparateCapture: false,
    supportsVoid: false,
    supportsRefund: true,
    supportsPartialCapture: false,
    supportsPartialRefund: true,
    defaultInitiator: 'GATEWAY',
    tokenSingleUse: true,
    tokenTTLMs: null,
    authHoldTTLMs: null,
    requiresClientScript: false,
    providesButton: false,
    providesIcon: true,
    providesPromoWidget: false,
    providesPriceTagMessaging: false,
    requiresDomainVerification: false,
    requiresMerchantCapabilityCheck: false,
    onShippingAddressChange: false,
    onShippingMethodChange: false,
    onCouponChange: false,
    onPaymentMethodChange: false,
    requiresWebhook: true,
    pollingFallback: true,
    expectedEvents: BASE_EVENTS_ASYNC,
    terminalFromWebhook: true,
  },
  voucher: {
    supportsGatewayInitiated: true,
    supportsMerchantInitiated: false,
    supportsSeparateCapture: false,
    supportsVoid: false,
    supportsRefund: true,
    supportsPartialCapture: false,
    supportsPartialRefund: false,
    defaultInitiator: 'GATEWAY',
    tokenSingleUse: true,
    tokenTTLMs: null,
    authHoldTTLMs: null,
    requiresClientScript: false,
    providesButton: false,
    providesIcon: true,
    providesPromoWidget: false,
    providesPriceTagMessaging: false,
    requiresDomainVerification: false,
    requiresMerchantCapabilityCheck: false,
    onShippingAddressChange: false,
    onShippingMethodChange: false,
    onCouponChange: false,
    onPaymentMethodChange: false,
    requiresWebhook: true,
    pollingFallback: true,
    expectedEvents: BASE_EVENTS_VOUCHER,
    terminalFromWebhook: true,
  },
};

// Per-APM hand overrides. Only APMs that diverge from the pattern defaults
// need an entry here. Accuracy is load-bearing: the UI reads these to
// decide which callback cards/buttons/widgets to render.
const OVERRIDES: Record<string, Partial<SyntheticCapabilities>> = {
  // ── Tokenization (BNPL widget SDKs) ──────────────────────────
  klarna: {
    cdnUrl: 'https://x.klarnacdn.net/kp/lib/v1/api.js',
    globalVariable: 'Klarna',
    providesPromoWidget: true,
    providesPriceTagMessaging: true,
    amountTransform: 'MULTIPLY_100',
    // Klarna does NOT expose shipping/coupon callbacks.
    // Widget handles cart internally.
  },
  affirm: {
    providesPromoWidget: true,
    providesPriceTagMessaging: true,
    amountTransform: 'MULTIPLY_100',
  },
  afterpay: {
    providesPromoWidget: true,
    providesPriceTagMessaging: true,
    amountTransform: 'NUMBER_TO_STRING',
  },
  sezzle: { providesPromoWidget: true, amountTransform: 'MULTIPLY_100' },
  zip: { providesPromoWidget: true, amountTransform: 'MULTIPLY_100' },

  // ── Native wallets — ONLY these 2 have real callbacks ────────
  applepay: {
    cdnUrl: null,
    globalVariable: 'ApplePaySession',
    requiresDomainVerification: true,
    requiresMerchantCapabilityCheck: true,
    amountTransform: 'PASSTHROUGH',
    // Apple Pay JS has all 4 interactive callbacks.
    onShippingAddressChange: true,
    onShippingMethodChange: true,
    onCouponChange: true, // iOS 16+
    onPaymentMethodChange: true,
    providerCallbackNames: {
      onShippingAddressChange: 'session.onshippingcontactselected',
      onShippingMethodChange: 'session.onshippingmethodselected',
      onCouponChange: 'session.oncouponcodechanged',
      onPaymentMethodChange: 'session.onpaymentmethodselected',
    },
  },
  googlepay: {
    cdnUrl: 'https://pay.google.com/gp/p/js/pay.js',
    globalVariable: 'google.payments.api.PaymentsClient',
    amountTransform: 'PASSTHROUGH',
    // Google Pay has ONE callback (paymentDataChanged) that handles
    // both shipping-address and shipping-method updates.
    onShippingAddressChange: true,
    onShippingMethodChange: true,
    onCouponChange: false,
    onPaymentMethodChange: false,
    providerCallbackNames: {
      onShippingAddressChange: 'paymentDataCallbacks.onPaymentDataChanged(SHIPPING_ADDRESS)',
      onShippingMethodChange: 'paymentDataCallbacks.onPaymentDataChanged(SHIPPING_OPTION)',
    },
  },

  // ── Button SDK — only PayPal proper exposes shipping callbacks ─
  paypal: {
    cdnUrl: 'https://www.paypal.com/sdk/js',
    globalVariable: 'paypal',
    amountTransform: 'PASSTHROUGH',
    onShippingAddressChange: true,
    onShippingMethodChange: true,
    onCouponChange: false,
    onPaymentMethodChange: false,
    providerCallbackNames: {
      onShippingAddressChange: 'paypal.Buttons({ onShippingAddressChange })',
      onShippingMethodChange: 'paypal.Buttons({ onShippingOptionsChange })',
    },
  },
  paypal_paylater: {
    cdnUrl: 'https://www.paypal.com/sdk/js',
    globalVariable: 'paypal',
    amountTransform: 'PASSTHROUGH',
    onShippingAddressChange: true,
    onShippingMethodChange: true,
    onCouponChange: false,
    onPaymentMethodChange: false,
    providerCallbackNames: {
      onShippingAddressChange: 'paypal.Buttons({ onShippingAddressChange })',
      onShippingMethodChange: 'paypal.Buttons({ onShippingOptionsChange })',
    },
  },
  venmo: {
    cdnUrl: 'https://www.paypal.com/sdk/js',
    globalVariable: 'paypal',
    amountTransform: 'PASSTHROUGH',
    // Venmo ships inside the PayPal SDK but the Venmo funding source
    // does NOT fire shipping callbacks — server-side only.
    onShippingAddressChange: false,
    onShippingMethodChange: false,
  },
  cashapp: {
    cdnUrl: 'https://kit.cash.app/v1/pay.js',
    globalVariable: 'CashApp',
    amountTransform: 'MULTIPLY_100',
  },

  // ── Misc wire transforms ─────────────────────────────────────
  alipayplus: { amountTransform: 'DECIMAL_TO_STRING_CENTS' },
  wechatpay: { amountTransform: 'MULTIPLY_100' },
};

function scenariosFor(pattern: Pattern, supportsCapture: boolean, supportsRefund: boolean): string[] {
  const base = ['sale_ok', 'sale_decline', 'sale_timeout', 'script_load_failed'];
  if (supportsCapture) {
    base.push('authorize_ok_capture_ok', 'authorize_ok_partial_capture', 'authorize_ok_void', 'authorize_ok_auth_expires');
  }
  if (supportsRefund) {
    base.push('refund_ok');
  }
  if (pattern === 'redirect' || pattern === 'qr' || pattern === 'voucher') {
    base.push('webhook_pending_then_complete', 'webhook_pending_then_failed', 'webhook_pending_then_cancelled');
  }
  if (pattern === 'tokenization' || pattern === 'native-wallet' || pattern === 'button-sdk') {
    base.push('shipping_address_change', 'coupon_applied');
  }
  if (pattern === 'native-wallet') {
    base.push('single_use_token_retry', 'merchant_validation');
  }
  return base;
}

export function buildSyntheticCapabilities(m: ApmCommerceHubMapping): SyntheticCapabilities {
  const defaults = PATTERN_DEFAULTS[m.pattern];
  const override = OVERRIDES[m.id] ?? {};
  const caps: SyntheticCapabilities = {
    pattern: m.pattern,
    region: regionFor(m.countries),
    ...defaults,
    cdnUrl: null,
    globalVariable: null,
    amountTransform: 'MULTIPLY_100',
    eligibleScenarios: [],
    ...override,
  };
  caps.eligibleScenarios = scenariosFor(
    m.pattern,
    caps.supportsSeparateCapture,
    caps.supportsRefund
  );
  return caps;
}
