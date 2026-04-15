/**
 * APM → Commerce Hub mapping table.
 *
 * SINGLE SOURCE OF TRUTH for every APM the SDK supports. Maps the
 * lowercase adapter id (used in URL paths and the registry) to the
 * exact CH wire fields the reference server must set on the
 * `POST /checkouts/v1/orders` request body.
 *
 * Architectural rule (validated 2026-04-14 against the prior APM mapping
 * project at output/ideal-via-ppro/):
 *
 *   - The merchant backend has ONE upstream call: CH /checkouts/v1/orders
 *   - CH owns the fan-out to providers (Klarna, PayPal, PPRO, etc.)
 *   - For PPRO-routed methods (~39 of them), the CH wire body sets
 *       paymentMethod.provider = uppercase(adapterId)
 *     CH internally translates to PPRO /v1/payment-charges. The string
 *     "PPRO" never appears in the CH wire — PPRO is an internal CH routing
 *     concept the merchant backend doesn't see.
 *   - For wallets (Apple Pay, Google Pay, PayPal, Venmo, CashApp), the CH
 *     wire body sets paymentSource.sourceType = "DigitalWallet" + walletType
 *   - For direct BNPL/redirect APMs (Klarna, Affirm, Afterpay, Zepto, etc.),
 *     CH routes based on paymentMethod.provider with the provider's own name
 *
 * Source: output/ideal-via-ppro/config.json + mapping-ch-to-ppro-ideal.md
 *         confirmed pattern; all other entries extrapolated from v1's
 *         endpoint table + the v2.1 PPRO factory + cardfree-sdk for
 *         Klarna/CashApp/Apple Pay/Google Pay/PayPal naming.
 */

/**
 * The "aggregator" field is metadata only — it tells consumers (the
 * reference server, dashboards, audit logs) which CH internal routing
 * group an APM belongs to. It is NEVER sent on the wire to CH.
 */
export type Aggregator =
  | 'PPRO' // CH internally routes to PPRO /v1/payment-charges
  | 'KLARNA' // CH internally routes to Klarna BNPL
  | 'PAYPAL' // CH internally routes to PayPal
  | 'AFFIRM'
  | 'AFTERPAY'
  | 'WALLET' // device-API wallets (Apple Pay, Google Pay)
  | 'CASHAPP'
  | 'ZEPTO'
  | 'TABAPAY'
  | 'OTHER';

export type ChSourceType =
  | 'AlternativePaymentMethod'
  | 'DigitalWallet'
  | 'PaymentCard';

export interface ApmCommerceHubMapping {
  /** Lowercase adapter id (used in /v2/orders/:apm URL + registry). */
  id: string;
  /** Display name for UI. */
  displayName: string;
  /** Pattern bucket (matches AdapterCapabilities.pattern). */
  pattern:
    | 'redirect'
    | 'tokenization'
    | 'native-wallet'
    | 'button-sdk'
    | 'qr'
    | 'voucher';
  /** CH internal routing destination — METADATA, never on the wire. */
  aggregator: Aggregator;
  /** CH wire field: paymentSource.sourceType (REQUIRED). */
  chSourceType: ChSourceType;
  /** CH wire field: paymentSource.walletType (only for native wallets + PayPal-family). */
  chWalletType?: string;
  /** CH wire field: paymentMethod.provider (REQUIRED for non-wallet APMs). */
  chProvider?: string;
  /** ISO 4217 currencies the APM accepts. Empty array = all. */
  currencies: readonly string[];
  /** ISO 3166-1 alpha-2 countries the APM is available in. Empty array = global. */
  countries: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────
// PPRO-routed sub-methods (39 entries — the full v1 endpoint table)
// ─────────────────────────────────────────────────────────────────────
//
// Per output/ideal-via-ppro/mapping-ch-to-ppro-ideal.md:
//   chSourceType = "AlternativePaymentMethod"
//   chProvider   = uppercase(adapterId)
//   aggregator   = "PPRO"
//
// CH receives just the provider string (e.g. "IDEAL", "BANCONTACT") and
// internally routes to PPRO. Adding a new PPRO sub-method only requires
// one row here — no PPRO-specific code changes anywhere else in the SDK.

const PPRO_METHODS: readonly ApmCommerceHubMapping[] = [
  // ── European bank-redirect (mostly EUR) ──
  ppro('ideal',         'iDEAL',                   'redirect', ['EUR'],         ['NL']),
  ppro('bancontact',    'Bancontact',              'redirect', ['EUR'],         ['BE']),
  ppro('eps',           'EPS',                     'redirect', ['EUR'],         ['AT']),
  ppro('blik',          'BLIK',                    'redirect', ['PLN'],         ['PL']),
  ppro('trustly',       'Trustly',                 'redirect', ['SEK', 'EUR'],  ['SE', 'FI', 'DK', 'EE', 'LV', 'LT']),
  ppro('wero',          'Wero',                    'redirect', ['EUR'],         ['DE', 'FR', 'BE', 'NL', 'LU']),
  ppro('sofort',        'SOFORT',                  'redirect', ['EUR'],         ['DE', 'AT', 'CH', 'BE', 'NL', 'IT', 'ES']),
  ppro('giropay',       'Giropay',                 'redirect', ['EUR'],         ['DE']),
  ppro('przelewy24',    'Przelewy24',              'redirect', ['PLN', 'EUR'],  ['PL']),
  ppro('postfinance',   'PostFinance',             'redirect', ['CHF'],         ['CH']),
  ppro('mbway',         'MB WAY',                  'redirect', ['EUR'],         ['PT']),
  ppro('multibanco',    'Multibanco',              'voucher',  ['EUR'],         ['PT']),

  // ── Nordic mobile wallets ──
  ppro('swish',         'Swish',                   'redirect', ['SEK'],         ['SE']),
  ppro('vipps',         'Vipps',                   'redirect', ['NOK'],         ['NO']),
  ppro('mobilepay',     'MobilePay',               'redirect', ['DKK', 'EUR'],  ['DK', 'FI']),
  ppro('twint',         'TWINT',                   'redirect', ['CHF'],         ['CH']),

  // ── LATAM bank-redirect + voucher ──
  ppro('spei',          'SPEI',                    'redirect', ['MXN'],         ['MX']),
  ppro('pse',           'PSE',                     'redirect', ['COP'],         ['CO']),
  ppro('webpay',        'Webpay Plus',             'redirect', ['CLP'],         ['CL']),
  ppro('mercadopago',   'Mercado Pago',            'redirect', ['ARS', 'BRL', 'MXN', 'COP', 'CLP', 'PEN', 'UYU'], ['AR', 'BR', 'MX', 'CO', 'CL', 'PE', 'UY']),
  ppro('pix',           'PIX',                     'qr',       ['BRL'],         ['BR']),
  ppro('boleto',        'Boleto',                  'voucher',  ['BRL'],         ['BR']),
  ppro('oxxo',          'OXXO',                    'voucher',  ['MXN'],         ['MX']),
  ppro('efecty',        'Efecty',                  'voucher',  ['COP'],         ['CO']),
  ppro('rapipago',      'RapiPago',                'voucher',  ['ARS'],         ['AR']),
  ppro('pagoefectivo',  'PagoEfectivo',            'voucher',  ['PEN'],         ['PE']),

  // ── APAC bank + wallet + voucher ──
  ppro('paynow',        'PayNow',                  'qr',       ['SGD'],         ['SG']),
  ppro('gcash',         'GCash',                   'redirect', ['PHP'],         ['PH']),
  ppro('maya',          'Maya',                    'redirect', ['PHP'],         ['PH']),
  ppro('linepay',       'LINE Pay',                'redirect', ['JPY', 'TWD', 'THB'], ['JP', 'TW', 'TH']),
  ppro('kakaopay',      'KakaoPay',                'redirect', ['KRW'],         ['KR']),
  ppro('dana',          'DANA',                    'qr',       ['IDR'],         ['ID']),
  ppro('ovo',           'OVO',                     'redirect', ['IDR'],         ['ID']),
  ppro('shopeepay',     'ShopeePay',               'redirect', ['IDR', 'PHP', 'THB', 'VND', 'MYR', 'SGD'], ['ID', 'PH', 'TH', 'VN', 'MY', 'SG']),
  ppro('touchngo',      "Touch 'n Go",             'redirect', ['MYR'],         ['MY']),
  ppro('alipay',        'Alipay',                  'qr',       ['CNY'],         ['CN']),
  ppro('paypay',        'PayPay',                  'qr',       ['JPY'],         ['JP']),
  ppro('upi',           'UPI',                     'qr',       ['INR'],         ['IN']),
  ppro('konbini',       'Konbini',                 'voucher',  ['JPY'],         ['JP']),

  // ── v2.1 forward-compat extras (kept in factory for back-compat) ──
  ppro('mybank',        'MyBank',                  'redirect', ['EUR'],         ['IT']),
  ppro('finlandbanks',  'Finland Online Banking',  'redirect', ['EUR'],         ['FI']),
  ppro('baloto',        'Baloto',                  'voucher',  ['COP'],         ['CO']),
  ppro('pagofacil',     'PagoFácil',               'voucher',  ['ARS'],         ['AR']),
  ppro('redpagos',      'RedPagos',                'voucher',  ['UYU'],         ['UY']),
  ppro('sepa',          'SEPA Direct Debit',       'redirect', ['EUR'],         ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PT', 'IE', 'FI', 'LU']),
  ppro('becs',          'BECS Direct Debit',       'redirect', ['AUD'],         ['AU']),
  ppro('bacs',          'Bacs Direct Debit',       'redirect', ['GBP'],         ['GB']),
  ppro('paybybank',     'Pay by Bank',             'redirect', ['GBP'],         ['GB']),
  ppro('ppro_wechatpay','WeChat Pay (via PPRO)',   'qr',       ['CNY'],         ['CN']),
  ppro('ppro_naverpay', 'NaverPay (via PPRO)',     'redirect', ['KRW'],         ['KR']),
  ppro('ppro_gopay',    'GoPay (via PPRO)',        'qr',       ['IDR'],         ['ID']),
  ppro('ppro_truemoney','TrueMoney (via PPRO)',    'qr',       ['THB'],         ['TH']),
  ppro('ppro_promptpay','PromptPay (via PPRO)',    'qr',       ['THB'],         ['TH']),
  ppro('ppro_momo',     'MoMo (via PPRO)',         'qr',       ['VND'],         ['VN']),
];

// ─────────────────────────────────────────────────────────────────────
// Direct provider methods — CH routes to the provider directly,
// not through PPRO. Per cardfree-sdk + v1 endpoint table.
// ─────────────────────────────────────────────────────────────────────

const DIRECT_METHODS: readonly ApmCommerceHubMapping[] = [
  // ── Native wallets (device APIs) ──
  {
    id: 'applepay', displayName: 'Apple Pay', pattern: 'native-wallet',
    aggregator: 'WALLET',
    chSourceType: 'DigitalWallet', chWalletType: 'APPLE_PAY',
    currencies: [], countries: [],
  },
  {
    id: 'googlepay', displayName: 'Google Pay', pattern: 'native-wallet',
    aggregator: 'WALLET',
    chSourceType: 'DigitalWallet', chWalletType: 'GOOGLE_PAY',
    currencies: [], countries: [],
  },

  // ── Button-SDK wallets (PayPal family + Cash App + Venmo) ──
  {
    id: 'paypal', displayName: 'PayPal', pattern: 'button-sdk',
    aggregator: 'PAYPAL',
    chSourceType: 'DigitalWallet', chWalletType: 'PAYPAL', chProvider: 'PayPal',
    currencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'MXN', 'BRL'],
    countries: [],
  },
  {
    id: 'paypal_paylater', displayName: 'PayPal Pay Later', pattern: 'button-sdk',
    aggregator: 'PAYPAL',
    chSourceType: 'DigitalWallet', chWalletType: 'PAYPAL', chProvider: 'PayPalPayLater',
    currencies: ['USD', 'EUR', 'GBP'], countries: ['US', 'GB', 'DE', 'FR', 'AU'],
  },
  {
    id: 'venmo', displayName: 'Venmo', pattern: 'button-sdk',
    aggregator: 'PAYPAL',
    chSourceType: 'DigitalWallet', chWalletType: 'VENMO', chProvider: 'Venmo',
    currencies: ['USD'], countries: ['US'],
  },
  {
    id: 'cashapp', displayName: 'Cash App Pay', pattern: 'redirect',
    aggregator: 'CASHAPP',
    chSourceType: 'DigitalWallet', chWalletType: 'CASH_APP', chProvider: 'CashApp',
    currencies: ['USD'], countries: ['US'],
  },

  // ── Direct BNPL (tokenization base) ──
  {
    id: 'klarna', displayName: 'Klarna', pattern: 'tokenization',
    aggregator: 'KLARNA',
    chSourceType: 'AlternativePaymentMethod', chProvider: 'Klarna',
    currencies: ['USD', 'EUR', 'GBP', 'SEK', 'NOK', 'DKK', 'AUD', 'CAD', 'CHF', 'PLN'],
    countries: ['US', 'GB', 'DE', 'AT', 'CH', 'NL', 'BE', 'SE', 'NO', 'DK', 'FI', 'IT', 'ES', 'FR', 'AU', 'CA'],
  },
  {
    id: 'affirm', displayName: 'Affirm', pattern: 'tokenization',
    aggregator: 'AFFIRM',
    chSourceType: 'AlternativePaymentMethod', chProvider: 'Affirm',
    currencies: ['USD'], countries: ['US', 'CA'],
  },
  {
    id: 'afterpay', displayName: 'Afterpay', pattern: 'tokenization',
    aggregator: 'AFTERPAY',
    chSourceType: 'AlternativePaymentMethod', chProvider: 'Afterpay',
    currencies: ['USD', 'GBP', 'EUR', 'AUD', 'CAD', 'NZD'], countries: ['US', 'GB', 'AU', 'NZ', 'CA'],
  },
  {
    id: 'sezzle', displayName: 'Sezzle', pattern: 'tokenization',
    aggregator: 'OTHER',
    chSourceType: 'AlternativePaymentMethod', chProvider: 'Sezzle',
    currencies: ['USD', 'CAD'], countries: ['US', 'CA'],
  },
  {
    id: 'zip', displayName: 'Zip', pattern: 'tokenization',
    aggregator: 'OTHER',
    chSourceType: 'AlternativePaymentMethod', chProvider: 'Zip',
    currencies: ['USD', 'AUD', 'NZD', 'GBP'], countries: ['US', 'AU', 'NZ', 'GB'],
  },

  // ── QR pattern (direct, not via PPRO) ──
  // Note: alipay (China direct) lives in PPRO list above; alipayplus is the
  // multi-wallet aggregator from Ant Group, considered direct in v1.
  {
    id: 'alipayplus', displayName: 'Alipay+', pattern: 'qr',
    aggregator: 'OTHER',
    chSourceType: 'AlternativePaymentMethod', chProvider: 'AlipayPlus',
    currencies: ['USD', 'CNY', 'HKD', 'SGD', 'JPY', 'KRW', 'THB', 'MYR'],
    countries: ['CN', 'HK', 'SG', 'JP', 'KR', 'TH', 'MY', 'PH', 'ID'],
  },
  {
    id: 'wechatpay', displayName: 'WeChat Pay', pattern: 'qr',
    aggregator: 'OTHER',
    chSourceType: 'AlternativePaymentMethod', chProvider: 'WeChatPay',
    currencies: ['CNY', 'USD'], countries: ['CN'],
  },
  {
    id: 'grabpay', displayName: 'GrabPay', pattern: 'redirect',
    aggregator: 'OTHER',
    chSourceType: 'AlternativePaymentMethod', chProvider: 'GrabPay',
    currencies: ['SGD', 'MYR', 'PHP', 'THB', 'VND', 'IDR'],
    countries: ['SG', 'MY', 'PH', 'TH', 'VN', 'ID'],
  },

  // ── Direct bank-redirect (not via PPRO) ──
  {
    id: 'zepto', displayName: 'Zepto (PayTo)', pattern: 'redirect',
    aggregator: 'ZEPTO',
    chSourceType: 'AlternativePaymentMethod', chProvider: 'Zepto',
    currencies: ['AUD'], countries: ['AU'],
  },
  {
    id: 'tabapay', displayName: 'TabaPay', pattern: 'redirect',
    aggregator: 'TABAPAY',
    chSourceType: 'AlternativePaymentMethod', chProvider: 'TabaPay',
    currencies: ['USD'], countries: ['US'],
  },
];

// ── Helper: build a PPRO entry with one line per row ──
function ppro(
  id: string,
  displayName: string,
  pattern: ApmCommerceHubMapping['pattern'],
  currencies: readonly string[],
  countries: readonly string[]
): ApmCommerceHubMapping {
  return {
    id,
    displayName,
    pattern,
    aggregator: 'PPRO',
    chSourceType: 'AlternativePaymentMethod',
    chProvider: id.toUpperCase(),
    currencies,
    countries,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/** Frozen map keyed by adapter id. */
export const APM_MAPPING: Readonly<Record<string, ApmCommerceHubMapping>> =
  Object.freeze(
    [...PPRO_METHODS, ...DIRECT_METHODS].reduce<
      Record<string, ApmCommerceHubMapping>
    >((acc, entry) => {
      if (acc[entry.id]) {
        throw new Error(`APM_MAPPING: duplicate id ${entry.id}`);
      }
      acc[entry.id] = entry;
      return acc;
    }, {})
  );

/** All APMs the SDK supports, sorted by id. */
export const ALL_APM_IDS: readonly string[] = Object.freeze(
  Object.keys(APM_MAPPING).sort()
);

/** Just the PPRO-routed subset. */
export const PPRO_APM_IDS: readonly string[] = Object.freeze(
  PPRO_METHODS.map((m) => m.id)
);

/**
 * Lookup an APM mapping. Returns `undefined` for unknown ids so callers
 * can decide between 400 (validation error) and 500 (server bug).
 *
 * The reference server's `routes/orders.ts` handler returns
 * `{ error: 'UNKNOWN_APM' }` with a 400 response when this returns undefined.
 */
export function getApmMapping(id: string): ApmCommerceHubMapping | undefined {
  return APM_MAPPING[id];
}

/** True if the given APM is PPRO-routed (CH-internal). */
export function isPproRouted(id: string): boolean {
  return APM_MAPPING[id]?.aggregator === 'PPRO';
}

/** Counts for dashboards / docs. */
export const APM_STATS = Object.freeze({
  total: ALL_APM_IDS.length,
  ppro: PPRO_APM_IDS.length,
  direct: DIRECT_METHODS.length,
} as const);
