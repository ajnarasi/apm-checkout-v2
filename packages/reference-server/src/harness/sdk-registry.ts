/**
 * v2.2 harness — Provider SDK registry.
 *
 * Declarative metadata the browser harness uses to:
 *   1. Know which provider CDN URL to inject for a given APM
 *   2. Know which window global to poll for after injection
 *   3. Know how to render the provider's button/widget once the script loads
 *   4. Know which interactive callbacks the provider supports so the
 *      harness can render a matching configurator
 *
 * Kept on the server so the frontend has a single source of truth it can
 * fetch via GET /v2/harness/sdk-registry. The real render functions live
 * in `public/assets/sdk-loader.js` (they can't live here — they run in the
 * browser, not node).
 */

export interface SdkRegistryEntry {
  /** APM id (matches ApmCommerceHubMapping.id). */
  apm: string;
  /** Human label for the UI. */
  displayName: string;
  /**
   * Which render strategies this entry ships with. Keys match the
   * `RENDERERS` table in public/assets/sdk-loader.js. Omit an entry if
   * the harness only demonstrates sandbox loading without a dedicated
   * button/widget render path.
   */
  strategy:
    | 'paypal' // covers paypal, paypal_paylater, venmo (same SDK)
    | 'cashapp'
    | 'klarna'
    | 'affirm'
    | 'afterpay'
    | 'applepay'
    | 'googlepay'
    | 'none';
  /**
   * Script URL template. Placeholders:
   *   {clientId}        → sandbox client id
   *   {currency}        → active currency
   *   {merchantId}      → sandbox merchant id (optional)
   *   {components}      → comma-separated component list (paypal only)
   *   {enableFunding}   → enable-funding flag (paypal only)
   */
  cdnUrl: string;
  /** window global the loader polls for after script injection. */
  globalVariable: string;
  /**
   * Field schema for the credentials form the harness renders. Each
   * entry becomes an <input> the user fills in before clicking Load.
   */
  credentialFields: Array<{
    key: string;
    label: string;
    placeholder: string;
    required: boolean;
    helper?: string;
  }>;
  /**
   * What the harness renders once the SDK is loaded. The frontend uses
   * this list to decide which mount points (button / promo widget /
   * native-wallet sheet) to show for this APM.
   */
  renderables: Array<'button' | 'promo-widget' | 'price-tag' | 'native-sheet'>;
  /** Short docs blurb shown beneath the form. */
  notes?: string;
}

export const SDK_REGISTRY: SdkRegistryEntry[] = [
  // ── PayPal / PayPal Pay Later / Venmo — one SDK, three facades ──
  {
    apm: 'paypal',
    displayName: 'PayPal',
    strategy: 'paypal',
    cdnUrl:
      'https://www.paypal.com/sdk/js?client-id={clientId}&currency={currency}&components=buttons,messages&intent=capture',
    globalVariable: 'paypal',
    credentialFields: [
      {
        key: 'clientId',
        label: 'PayPal client-id',
        placeholder: 'AXj…',
        required: true,
        helper:
          'From developer.paypal.com → My Apps & Credentials → Sandbox. Must be a sandbox client-id for the harness domain to render.',
      },
      {
        key: 'currency',
        label: 'Currency',
        placeholder: 'USD',
        required: true,
      },
    ],
    renderables: ['button', 'promo-widget', 'price-tag'],
    notes:
      'The PayPal SDK enforces a domain allowlist on some client-ids. If the buttons fail to render, add http://localhost:3849 to the allowed origins on your sandbox app.',
  },
  {
    apm: 'paypal_paylater',
    displayName: 'PayPal Pay Later',
    strategy: 'paypal',
    cdnUrl:
      'https://www.paypal.com/sdk/js?client-id={clientId}&currency={currency}&components=buttons,messages&enable-funding=paylater&intent=capture',
    globalVariable: 'paypal',
    credentialFields: [
      { key: 'clientId', label: 'PayPal client-id', placeholder: 'AXj…', required: true },
      { key: 'currency', label: 'Currency', placeholder: 'USD', required: true },
    ],
    renderables: ['button', 'promo-widget', 'price-tag'],
    notes: 'Pay Later uses the same SDK as PayPal with enable-funding=paylater.',
  },
  {
    apm: 'venmo',
    displayName: 'Venmo',
    strategy: 'paypal',
    cdnUrl:
      'https://www.paypal.com/sdk/js?client-id={clientId}&currency={currency}&components=buttons&enable-funding=venmo&intent=capture',
    globalVariable: 'paypal',
    credentialFields: [
      { key: 'clientId', label: 'PayPal client-id (Venmo-enabled)', placeholder: 'AXj…', required: true },
      { key: 'currency', label: 'Currency', placeholder: 'USD', required: true },
    ],
    renderables: ['button'],
    notes:
      'Venmo ships inside the PayPal SDK with enable-funding=venmo. Your sandbox PayPal app must have Venmo enabled.',
  },

  // ── Cash App Pay ──
  {
    apm: 'cashapp',
    displayName: 'Cash App Pay',
    strategy: 'cashapp',
    cdnUrl: 'https://sandbox.kit.cash.app/v1/pay.js',
    globalVariable: 'CashApp',
    credentialFields: [
      {
        key: 'clientId',
        label: 'Cash App client-id',
        placeholder: 'CA-CI_xxxxxxxxxxxxxxxxxxxx',
        required: true,
        helper: 'From developers.cash.app → Sandbox → API Keys.',
      },
    ],
    renderables: ['button'],
    notes:
      'The harness loads the sandbox CDN (sandbox.kit.cash.app). Production uses kit.cash.app.',
  },

  // ── Klarna BNPL widget + on-site messaging ──
  {
    apm: 'klarna',
    displayName: 'Klarna',
    strategy: 'klarna',
    cdnUrl: 'https://x.klarnacdn.net/kp/lib/v1/api.js',
    globalVariable: 'Klarna',
    credentialFields: [
      {
        key: 'clientToken',
        label: 'Klarna client_token',
        placeholder: 'eyJhbGciOi…',
        required: false,
        helper:
          'Optional for on-site messaging, required for the full payment widget. If omitted, the harness will render only the promotional message.',
      },
      {
        key: 'dataKey',
        label: 'OnsiteMessaging data-key',
        placeholder: 'credit-promotion-badge',
        required: false,
        helper: 'Set this to render the Klarna on-site messaging placement.',
      },
    ],
    renderables: ['button', 'promo-widget', 'price-tag'],
    notes: 'Klarna placements are rendered via Klarna.OnsiteMessaging.refresh() and data-key="…".',
  },

  // ── Affirm promo widget ──
  {
    apm: 'affirm',
    displayName: 'Affirm',
    strategy: 'affirm',
    cdnUrl: 'https://cdn1-sandbox.affirm.com/js/v2/affirm.js',
    globalVariable: 'affirm',
    credentialFields: [
      {
        key: 'publicApiKey',
        label: 'Affirm public API key',
        placeholder: 'xxxxxxxxxxxxxxxx',
        required: true,
      },
      {
        key: 'country',
        label: 'Country',
        placeholder: 'USA',
        required: false,
      },
    ],
    renderables: ['promo-widget', 'price-tag'],
    notes:
      'Affirm ships a dedicated promo widget (As low as $X/mo). The harness inits affirm with your public key and calls affirm.ui.refresh().',
  },

  // ── Afterpay promo widget ──
  {
    apm: 'afterpay',
    displayName: 'Afterpay',
    strategy: 'afterpay',
    cdnUrl: 'https://js.afterpay.com/afterpay-1.x.js',
    globalVariable: 'AfterPay',
    credentialFields: [
      {
        key: 'merchantKey',
        label: 'Afterpay merchant key',
        placeholder: 'xxxxxxxx',
        required: true,
      },
      { key: 'currency', label: 'Currency', placeholder: 'USD', required: true },
    ],
    renderables: ['promo-widget', 'price-tag'],
  },

  // ── Apple Pay (device API, no CDN) ──
  {
    apm: 'applepay',
    displayName: 'Apple Pay',
    strategy: 'applepay',
    cdnUrl: '',
    globalVariable: 'ApplePaySession',
    credentialFields: [
      {
        key: 'merchantId',
        label: 'Apple Pay merchant-id',
        placeholder: 'merchant.com.your.app',
        required: true,
        helper:
          'Your merchant-id must be paired with a verified domain. The harness only probes window.ApplePaySession; full validation requires merchant cert signing on the server.',
      },
      { key: 'countryCode', label: 'Country code', placeholder: 'US', required: true },
      { key: 'currencyCode', label: 'Currency code', placeholder: 'USD', required: true },
    ],
    renderables: ['button', 'native-sheet'],
    notes:
      'Apple Pay is a device API, not a CDN. The harness checks window.ApplePaySession, calls ApplePaySession.canMakePayments(), and attempts to construct a session. Chrome cannot render the native sheet; Safari is required for a full flow.',
  },

  // ── Google Pay ──
  {
    apm: 'googlepay',
    displayName: 'Google Pay',
    strategy: 'googlepay',
    cdnUrl: 'https://pay.google.com/gp/p/js/pay.js',
    globalVariable: 'google',
    credentialFields: [
      {
        key: 'gatewayMerchantId',
        label: 'Gateway merchant id',
        placeholder: 'commercehub-sandbox',
        required: true,
      },
      { key: 'merchantId', label: 'Google merchant id', placeholder: '01234…', required: true },
      { key: 'environment', label: 'Environment', placeholder: 'TEST', required: true },
    ],
    renderables: ['button'],
    notes: 'The harness uses google.payments.api.PaymentsClient with environment=TEST.',
  },
];

export function getSdkRegistryEntry(apm: string): SdkRegistryEntry | undefined {
  return SDK_REGISTRY.find((e) => e.apm === apm);
}
